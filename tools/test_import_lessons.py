import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import taxonomy
from import_lessons import SUBJECT_MAP, make_card

TAXONOMY = taxonomy.load_map()


class ImportLessonsTests(unittest.TestCase):
    def test_subject_map_points_at_real_contract_entries(self):
        """导入源的学科/标尺必须都在契约里：这里改漏，App 会静默显示「未分级」。"""
        subjects = taxonomy.index(TAXONOMY)
        for key, spec in SUBJECT_MAP.items():
            self.assertIn(spec["subject"], subjects, f"来源 {key} 指向未知学科")
            if spec.get("track"):
                self.assertIn(spec["track"], subjects[spec["subject"]]["tracks"])

    def test_english_is_no_longer_flattened_into_trivia(self):
        """历史缺陷：英语整门课被压成「冷知识」。三级体系下它必须落在 english。"""
        self.assertEqual(SUBJECT_MAP["en"]["subject"], "english")
        card = make_card({"title": "定语从句", "text": "足够完整的课程正文", "tldr": "摘要"},
                         SUBJECT_MAP["en"], TAXONOMY, 1)
        self.assertEqual(card["subject"], "english")
        self.assertEqual(card["category"], "英语")

    def test_card_carries_order_key_and_optional_grading(self):
        card = make_card(
            {"title": "存货跌价准备", "text": "足够完整的课程正文", "tldr": "摘要",
             "tag": "资产", "level": 3},
            SUBJECT_MAP["kj"], TAXONOMY, 7)
        self.assertEqual(card["branch"], "assets")          # tag 命中分支名 → 写 slug
        self.assertEqual(card["level"], 3)
        self.assertEqual(card["track"], "中级会计")
        self.assertEqual(card["orderKey"], "accounting/assets/0007")
        self.assertEqual(taxonomy.validate_card(card, TAXONOMY), [])

    def test_unknown_tag_is_dropped_but_bad_level_is_flagged(self):
        """对不上契约的 tag 直接不写（不猜分支）；越界的 level 原样保留，
        交给 validate_card 报错——素材里的数据错误必须响，不能被静默吞掉。"""
        card = make_card({"title": "标题", "text": "足够完整的课程正文", "tldr": "摘要",
                          "tag": "不存在的分支", "level": 9},
                         SUBJECT_MAP["ai"], TAXONOMY, 2)
        self.assertNotIn("branch", card)
        self.assertEqual(card["orderKey"], "ai/all/0002")
        self.assertTrue(taxonomy.validate_card(card, TAXONOMY))   # 难度越界被点名

        clean = make_card({"title": "标题", "text": "足够完整的课程正文", "tldr": "摘要", "level": "3"},
                          SUBJECT_MAP["ai"], TAXONOMY, 3)
        self.assertNotIn("level", clean)                            # 非数字不写入
        self.assertEqual(taxonomy.validate_card(clean, TAXONOMY), [])

    def test_missing_content_is_rejected(self):
        with self.assertRaises(ValueError):
            make_card({"title": "空课程"}, SUBJECT_MAP["ai"], TAXONOMY, 1)

    def test_repeated_import_preserves_existing_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = []
            for key in SUBJECT_MAP:
                path = root / f"{key}-content.json"
                path.write_text(json.dumps({"parts": [{"topics": [{"lessons": [
                    {"title": f"{key}课程", "text": "足够完整的课程正文", "tldr": "摘要"}
                ]}]}]}))
                paths.append(str(path))
            output = root / "seed_cards.json"
            original = [{"category": "冷知识", "headline": "原卡", "summary": "摘要", "details": "详情", "links": []}]
            output.write_text(json.dumps(original))
            command = [sys.executable, str(Path(__file__).with_name("import_lessons.py")), "--sources", *paths, "--output", str(output)]
            subprocess.run(command, check=True, capture_output=True)
            first = output.read_bytes()
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(output.read_bytes(), first)
            cards = json.loads(first)
            self.assertEqual(len(cards), 5)
            self.assertEqual(cards[:1], original)


if __name__ == "__main__":
    unittest.main()

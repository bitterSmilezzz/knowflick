import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from import_lessons import CATEGORY_MAP, make_card


class ImportLessonsTests(unittest.TestCase):
    def test_categories_match_current_registry(self):
        self.assertEqual(set(CATEGORY_MAP.values()), {"中级会计", "AI", "AI 开发", "冷知识"})

    def test_missing_content_is_rejected(self):
        with self.assertRaises(ValueError):
            make_card({"title": "空课程"}, "AI")

    def test_repeated_import_preserves_existing_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = []
            for key in CATEGORY_MAP:
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

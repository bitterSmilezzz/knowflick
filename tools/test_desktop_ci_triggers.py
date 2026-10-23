#!/usr/bin/env python3
"""Protect the frozen desktop's CI dependency boundary (standard library only).

Only reads the explicit push/PR paths lists used by desktop.yml. This is not a
YAML parser or a complete GitHub glob implementation; unsupported patterns fail
rather than silently claiming coverage.
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(ROOT / "tools"))
from workflow_paths import matches, paths_for  # noqa: E402


class DesktopCITriggers(unittest.TestCase):
    def test_dependencies_trigger_push_and_pull_request(self):
        text = (ROOT / '.github/workflows/desktop.yml').read_text(encoding='utf-8')
        witnesses = [
            'apps/android/desktop/build.gradle.kts',
            'apps/android/domain/src/commonMain/Example.kt',
            'apps/android/shared-ui/src/commonMain/Example.kt',
            'apps/android/shared-data/src/commonMain/Example.kt',
            'apps/android/build.gradle.kts',
            'apps/android/settings.gradle.kts',
            'apps/android/gradle.properties',
            'apps/android/gradlew',
            'apps/android/gradlew.bat',
            'apps/android/gradle/wrapper/gradle-wrapper.properties',
            'apps/android/gradle/libs.versions.toml',
            'shared/assets/taxonomy_map.json',
            'shared/icons/AppIcon.ico',
            'tools/ci_gradle_official_source.sh',
            'tools/test_desktop_ci_triggers.py',
            '.github/workflows/desktop.yml',
        ]
        for event in ('push', 'pull_request'):
            patterns = paths_for(text, event)
            for path in witnesses:
                with self.subTest(event=event, path=path):
                    self.assertTrue(any(matches(path, p) for p in patterns),
                                    f'{event}.paths misses {path}')
            # Android host changes must not spend three desktop runners.
            self.assertFalse(any(matches('apps/android/app/src/main/Example.kt', p)
                                 for p in patterns))

    def test_regression_runs_before_gradle_with_bash(self):
        text = (ROOT / '.github/workflows/desktop.yml').read_text(encoding='utf-8')
        self.assertRegex(
            text,
            r'shell: bash\n        run: python3 -m unittest discover -s tools -p test_desktop_ci_triggers\.py',
        )
        self.assertLess(text.index('run: python3 -m unittest'), text.index('xvfb-run -a ./gradlew'))

    def test_paths_reader_ignores_comments_and_other_events(self):
        text = "  push:\n    paths:\n      # explanation\n      - 'a/**'\n  pull_request:\n    paths:\n      - 'b/**'\n"
        self.assertEqual(paths_for(text, 'push'), ['a/**'])
        self.assertEqual(paths_for(text, 'pull_request'), ['b/**'])

    def test_trailing_comment_on_a_path_entry_is_tolerated(self):
        # YAML 允许 `- 'path'  # 备注`，GitHub 也认。解析不了就该报错，
        # 但更该**认得**——否则有人只是加了句说明，门禁就红。
        text = "  push:\n    paths:\n      - 'a/**'  # 说明\n  pull_request:\n    paths:\n      - 'b/**'\n"
        self.assertEqual(paths_for(text, 'push'), ['a/**'])
        self.assertEqual(paths_for(text, 'pull_request'), ['b/**'])

    def test_missing_or_unsupported_paths_fail_explicitly(self):
        with self.assertRaises(ValueError):
            paths_for('  push:\n    branches: [main]\n', 'push')
        with self.assertRaises(ValueError):
            paths_for('  push:\n    paths:\n      - [a, b]\n', 'push')
        with self.assertRaises(ValueError):
            matches('a/b', '!a/**')

    def test_prefix_does_not_match_sibling_directory(self):
        self.assertTrue(matches('shared/assets/x', 'shared/assets/**'))
        self.assertFalse(matches('shared/assets-old/x', 'shared/assets/**'))


if __name__ == '__main__':
    unittest.main()

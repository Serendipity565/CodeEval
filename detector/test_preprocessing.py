import unittest

from model_sources import normalize_language
from preprocessing import preprocess


class PreprocessingTests(unittest.TestCase):
    def test_source_and_offsets_are_preserved_for_all_languages(self):
        for language, code in [
            ('python', '# 注释\n\ndef f():\n    """docstring"""\n    return "# data"\n'),
            ('java', '// comment\nclass Main { String s = "/* data */"; }\n'),
            ('cpp', '/* comment */\n#include <iostream>\nint main() {}\n'),
            ('go', '// comment\npackage main\nfunc main() {}\n'),
        ]:
            self.assertEqual(preprocess(code, language), code)

    def test_cpp_aliases(self):
        for name in ('C++', 'cpp', 'CXX', ' c++ '):
            self.assertEqual(normalize_language(name), 'cpp')


if __name__ == '__main__':
    unittest.main()

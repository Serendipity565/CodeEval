"""Opt-in real checkpoint checks: set CODEEVAL_TEST_MODEL_DIR to initialized artifacts."""

import os
from pathlib import Path
import unittest


@unittest.skipUnless(os.environ.get('CODEEVAL_TEST_MODEL_DIR'), 'requires pinned local model artifacts')
class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from engine import Engine
        from settings import Settings
        cls.engine = Engine(Settings(provider='droiddetect', token='test', cpu_threads=2,
                                     max_code_bytes=100000, device='cpu',
                                     model_dir=Path(os.environ['CODEEVAL_TEST_MODEL_DIR'])))

    def test_project_languages_use_binary_score_and_original_lines(self):
        from model_sources import VERSION, PREPROCESSING_VERSION
        examples = {
            'python': '# 中文注释\nprint(sum(map(int, input().split())))\n',
            'java': '// comment\nclass Main { public static void main(String[] args) { System.out.println(1); } }',
            'cpp': '/* comment */\n#include <iostream>\nint main() { std::cout << 1; }',
            'go': '// comment\npackage main\nimport "fmt"\nfunc main() { fmt.Println(1) }',
        }
        for language, code in examples.items():
            with self.subTest(language=language):
                result = self.engine.detect(code, language)
                self.assertEqual(result['version'], VERSION)
                self.assertEqual(result['preprocessingVersion'], PREPROCESSING_VERSION)
                self.assertEqual(result['device'], 'cpu')
                self.assertGreaterEqual(result['aiScore'], 0)
                self.assertLessEqual(result['aiScore'], 1)
                self.assertEqual(result['coveredTokens'], result['totalTokens'])
                self.assertEqual(result['chunks'][0]['startLine'], 1)
                self.assertFalse(result['truncated'])

    def test_single_window_matches_direct_model_card_forward_and_ai_class(self):
        import torch
        code = '# preserve this comment\nprint(123)'
        # Independent direct tokenization checks special tokens, batch dimension,
        # mean pooling, class direction and the window adapter against raw input.
        inputs = self.engine.tokenizer(code, return_tensors='pt', return_token_type_ids=False)
        model = self.engine.model
        with torch.inference_mode():
            hidden = model.text_encoder(**inputs).last_hidden_state.mean(dim=1)
            logits = model.classifier(torch.relu(model.text_projection(hidden)))
            expected = torch.softmax(logits, dim=-1)[0, 1].item()
        self.assertAlmostEqual(self.engine.detect(code, 'python')['aiScore'], expected, places=6)
        self.assertEqual(tuple(model.text_projection.weight.shape), (256, 768))
        self.assertEqual(tuple(model.classifier.weight.shape), (2, 256))

    def test_long_unicode_source_has_complete_nonduplicated_coverage(self):
        code = '\n'.join(f'# 注释 {i}\nvalue_{i} = {i}' for i in range(90))
        result = self.engine.detect(code, 'python')
        expected_tokens = len(self.engine.tokenizer(code, add_special_tokens=False)['input_ids'])
        self.assertEqual(result['totalTokens'], expected_tokens)
        self.assertGreater(len(result['chunks']), 1)
        self.assertEqual(sum(c['weightTokens'] for c in result['chunks']), expected_tokens)
        for chunk in result['chunks']:
            self.assertGreaterEqual(chunk['startLine'], 1)
            self.assertLessEqual(chunk['endLine'], len(code.splitlines()))
            self.assertLessEqual(chunk['tokenCount'], 510)
        weighted = sum(c['aiScore'] * c['weightTokens'] for c in result['chunks']) / expected_tokens
        self.assertAlmostEqual(result['aiScore'], weighted)
        self.assertEqual(result['chunks'][-1]['endLine'], len(code.splitlines()))

    def test_blank_source_has_no_score_but_comments_are_retained(self):
        result = self.engine.detect(' \n\t', 'python')
        self.assertIsNone(result['aiScore'])
        self.assertEqual(result['chunks'], [])
        self.assertEqual(result['totalTokens'], 0)
        self.assertGreater(self.engine.detect('# comment only', 'python')['totalTokens'], 0)

    def test_over_limit_input_fails_without_partial_score(self):
        from fastapi import HTTPException
        old_limit = self.engine.max_chunks
        self.engine.max_chunks = 1
        try:
            with self.assertRaises(HTTPException) as error:
                self.engine.detect('print(1)\n' * 200, 'python')
            self.assertEqual(error.exception.status_code, 413)
        finally:
            self.engine.max_chunks = old_limit


if __name__ == '__main__':
    unittest.main()

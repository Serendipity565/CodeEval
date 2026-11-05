"""Device-selection contract cases; no GPU or PyTorch import required."""

import unittest

from runtime import select_device


class RuntimeTests(unittest.TestCase):
    def test_cuda_mode_requires_visible_gpu(self):
        self.assertEqual(select_device("cuda", True), "cuda:0")
        with self.assertRaisesRegex(RuntimeError, "No CPU inference was started"):
            select_device("cuda", False)

    def test_auto_mode_selects_available_device(self):
        self.assertEqual(select_device("auto", True), "cuda:0")
        self.assertEqual(select_device("auto", False), "cpu")

    def test_cpu_mode_does_not_use_visible_gpu(self):
        self.assertEqual(select_device("cpu", True), "cpu")

    def test_invalid_mode_is_rejected(self):
        with self.assertRaises(RuntimeError):
            select_device("invalid", True)


if __name__ == "__main__":
    unittest.main()

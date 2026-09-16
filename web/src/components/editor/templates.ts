const templates: Record<string, string> = {
  Python:
    'import sys\n\n# 从 sys.stdin 读取输入，只将最终答案写入标准输出。\ndef main():\n    data = sys.stdin.read()\n    # 在这里实现\n\nif __name__ == "__main__":\n    main()\n',
  Go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\t// 使用 fmt.Scan / bufio 从标准输入读取，只输出最终答案。\n\t_ = fmt.Print\n}\n',
  Java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        // 从标准输入读取，只输出最终答案。\n    }\n}\n",
  "C++":
    "#include <iostream>\nusing namespace std;\n\nint main() {\n    // 使用 cin 读取标准输入，只使用 cout 输出最终答案。\n    return 0;\n}\n",
  JavaScript: "// 在这里编写 JavaScript 代码\n",
};

export const editorTemplate = (language: string) =>
  templates[language] ?? "// 在这里编写代码\n";

export const executionContract = (language: string) => {
  const entrypoints: Record<string, string> = {
    Go: "package main + func main()",
    Java: "public class Main + public static void main(String[] args)",
    "C++": "int main()",
    Python: "可直接执行的 Python 程序",
  };
  return `提交完整可执行程序（${entrypoints[language] ?? "包含程序入口"}），从标准输入读取测试数据，只把最终答案写入标准输出。不要只提交单个函数。`;
};

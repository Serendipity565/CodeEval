const templates: Record<string, string> = {
  Python: '# 在这里编写 Python 代码\n',
  Go: 'package main\n\nfunc main() {\n\t\n}\n',
  Java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n',
  'C++': '#include <iostream>\n\nint main() {\n    return 0;\n}\n',
  JavaScript: '// 在这里编写 JavaScript 代码\n',
}

export const editorTemplate = (language: string) => templates[language] ?? '// 在这里编写代码\n'

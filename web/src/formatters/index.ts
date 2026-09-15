type Formatter = (source: string) => Promise<string>

const providers: Record<string, Formatter> = {
  Go: async source => {
    const formatter = await import('@wasm-fmt/gofmt/vite')
    await formatter.default()
    return formatter.format(source)
  },
  Python: async source => {
    const formatter = await import('@wasm-fmt/ruff_fmt/vite')
    await formatter.default()
    return formatter.format(source, 'solution.py', { line_width: 88, indent_style: 'space', indent_width: 4 })
  },
  'C++': async source => {
    const formatter = await import('@wasm-fmt/clang-format/vite')
    await formatter.default()
    return formatter.format(source, 'solution.cpp', JSON.stringify({ BasedOnStyle: 'Google', IndentWidth: 4, ColumnLimit: 100 }))
  },
  JavaScript: async source => {
    const [{ format }, babel, estree] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ])
    return format(source, { parser: 'babel', plugins: [babel.default, estree.default], tabWidth: 2, semi: false, singleQuote: true })
  },
  Java: async source => {
    const [{ format }, java] = await Promise.all([import('prettier/standalone'), import('prettier-plugin-java')])
    return format(source, { parser: 'java', plugins: [java.default], tabWidth: 4, printWidth: 100 })
  },
}

export function hasFormatter(language: string) {
  return language in providers
}

export async function formatDocument(language: string, source: string) {
  const provider = providers[language]
  if (!provider) throw new Error(`暂不支持 ${language} 格式化`)
  return provider(source)
}

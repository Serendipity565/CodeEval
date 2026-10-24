import { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tagHighlighter, tags } from "@lezer/highlight";

// VS Code Dark+ palette: microsoft/vscode/extensions/theme-defaults/themes/.
// CSS variables keep every code surface, including comparisons, in sync.
export const vscodeDarkTheme = [
  EditorView.theme(
    {
      "&": { color: "var(--code-fg)", backgroundColor: "var(--code-bg)" },
      ".cm-content": { caretColor: "var(--code-fg)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-fg)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "var(--code-selection)" },
      ".cm-gutters": {
        color: "var(--code-line-number)",
        backgroundColor: "var(--code-bg)",
        border: "none",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "var(--code-active-line)",
      },
      ".cm-activeLineGutter": { color: "#c6c6c6" },
      ".cm-matchingBracket": {
        color: "var(--code-fg)",
        backgroundColor: "#0064001a",
        outline: "1px solid #888888",
      },
      ".cm-searchMatch": {
        backgroundColor: "#515c6a80",
        outline: "1px solid #888888",
      },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#613315" },
      ".cm-selectionMatch": { backgroundColor: "#add6ff26" },
      ".cm-tooltip": {
        color: "var(--code-fg)",
        backgroundColor: "var(--code-panel)",
        border: "1px solid var(--code-border)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        color: "#ffffff",
        backgroundColor: "#04395e",
      },
      ".cm-panels": {
        color: "var(--code-fg)",
        backgroundColor: "var(--code-panel)",
      },
      ".cm-textfield": {
        color: "var(--code-fg)",
        backgroundColor: "var(--code-input)",
        border: "1px solid var(--code-border)",
      },
      ".cm-button": {
        color: "var(--code-fg)",
        backgroundImage: "none",
        backgroundColor: "var(--code-hover)",
      },
      ".cm-foldPlaceholder": {
        color: "var(--code-muted)",
        backgroundColor: "var(--code-hover)",
        border: "1px solid var(--code-border)",
      },
    },
    { dark: true },
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.comment, color: "var(--code-comment)" },
      { tag: [tags.keyword, tags.modifier], color: "var(--code-keyword)" },
      { tag: tags.controlKeyword, color: "var(--code-control)" },
      {
        tag: [
          tags.function(tags.variableName),
          tags.function(tags.propertyName),
        ],
        color: "var(--code-function)",
      },
      {
        tag: [tags.string, tags.special(tags.string)],
        color: "var(--code-string)",
      },
      { tag: tags.number, color: "var(--code-number)" },
      { tag: [tags.bool, tags.null], color: "var(--code-keyword)" },
      {
        tag: [tags.typeName, tags.className, tags.namespace],
        color: "var(--code-type)",
      },
      {
        tag: [tags.operator, tags.punctuation, tags.bracket],
        color: "var(--code-fg)",
      },
      {
        tag: [tags.variableName, tags.propertyName],
        color: "var(--code-variable)",
      },
      {
        tag: tags.invalid,
        color: "var(--code-invalid)",
        textDecoration: "underline wavy",
      },
    ]),
  ),
];

// The comparison view uses spans instead of CodeMirror; retain identical tags.
export const vscodeClassHighlighter = tagHighlighter([
  { tag: tags.comment, class: "tok-comment" },
  { tag: [tags.keyword, tags.modifier], class: "tok-keyword" },
  { tag: tags.controlKeyword, class: "tok-control" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function",
  },
  { tag: [tags.string, tags.special(tags.string)], class: "tok-string" },
  { tag: tags.number, class: "tok-number" },
  { tag: [tags.bool, tags.null], class: "tok-bool" },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    class: "tok-typeName",
  },
  { tag: [tags.variableName, tags.propertyName], class: "tok-variable" },
]);

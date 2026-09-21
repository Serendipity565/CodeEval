import { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const forestTheme = [
  EditorView.theme(
    {
      "&": { color: "#dbe5d5", backgroundColor: "#26372d" },
      ".cm-content": { caretColor: "#dbe9a1" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#dbe9a1" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "#4d6245" },
      ".cm-gutters": {
        color: "#889b82",
        backgroundColor: "#26372d",
        border: "none",
      },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#304334" },
      ".cm-activeLineGutter": { color: "#dbe9a1" },
      ".cm-matchingBracket": { color: "#e9efbe", backgroundColor: "#4b6042" },
      ".cm-searchMatch": {
        backgroundColor: "#61703f80",
        outline: "1px solid #9aab68",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "#7f8d4680",
      },
      ".cm-selectionMatch": { backgroundColor: "#435c4180" },
      ".cm-tooltip": {
        color: "#dbe5d5",
        backgroundColor: "#2c4032",
        border: "1px solid #53654c",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        color: "#e3edc0",
        backgroundColor: "#42583d",
      },
      ".cm-panels": { color: "#dbe5d5", backgroundColor: "#203126" },
      ".cm-textfield": {
        color: "#e0e8da",
        backgroundColor: "#293c2e",
        border: "1px solid #52654a",
      },
      ".cm-button": {
        color: "#dbe5d5",
        backgroundImage: "none",
        backgroundColor: "#384d38",
      },
      ".cm-foldPlaceholder": {
        color: "#c3d896",
        backgroundColor: "#344a35",
        border: "1px solid #4d6446",
      },
    },
    { dark: true },
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.comment, color: "#92a68a", fontStyle: "italic" },
      {
        tag: [tags.keyword, tags.modifier, tags.controlKeyword],
        color: "#c3d896",
      },
      {
        tag: [
          tags.function(tags.variableName),
          tags.function(tags.propertyName),
        ],
        color: "#e5d3a5",
      },
      { tag: [tags.string, tags.special(tags.string)], color: "#b8d6b0" },
      { tag: [tags.number, tags.bool, tags.null], color: "#e3c897" },
      {
        tag: [tags.typeName, tags.className, tags.namespace],
        color: "#b1d0bd",
      },
      {
        tag: [tags.operator, tags.punctuation, tags.bracket],
        color: "#b9c9ad",
      },
      { tag: [tags.variableName, tags.propertyName], color: "#dbe5d5" },
      { tag: tags.invalid, color: "#f0b1a0", textDecoration: "underline wavy" },
    ]),
  ),
];

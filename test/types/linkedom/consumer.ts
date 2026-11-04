// The README's Node example. Apart from test/types/consumer.ts because
// linkedom's own declarations don't compile against lib.dom, so this project
// needs skipLibCheck, which would stop checking the generated declarations there.
import { pageToMarkdown } from "page-markdown";
import { parseHTML } from "linkedom";

const { document: doc } = parseHTML("<p>x</p>");
export const markdown: string = pageToMarkdown(doc, { url: "https://example.com/article" }).markdown;

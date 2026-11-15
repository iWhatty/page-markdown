import { pageToMarkdown } from 'page-markdown/trial';
import type { PageMarkdownOptions, TrialDiagnostics } from 'page-markdown/trial';

declare const document: Document;
const options: PageMarkdownOptions = { diagnostics: 'trial', detectConcealedText: true };
const diagnostics: TrialDiagnostics | undefined = pageToMarkdown(document, options).diagnostics;
void diagnostics;

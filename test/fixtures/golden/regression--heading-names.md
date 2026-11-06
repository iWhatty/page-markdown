# Admonitions

Admonitions are special blocks of text that the theme renders with an icon and a colour, so that a reader notices them while scanning the page for what matters.

## Usage with Prettier

If you use Prettier to format your Markdown files, it may change the blank lines around the markers, so keep an empty line between the markers and their content.

## Specifying title

You may also specify an optional title, which replaces the default label shown beside the icon, and it can hold inline Markdown such as emphasis or code.

## Types

A short heading beside a worded permalink is the case that Readability removes as clutter, because the wrapper holds little text and some of that text is a link.

### Usage

Sites also build the permalink from a custom element, which has an href without being a link, so the rule looks at where it points and not at what it is called.

## Icon

The permalink can also sit inside the heading, where it would otherwise become part of the heading's own text and show up in every outline of the page.

## Theming

A heading that is wholly a link to itself keeps its text, and this paragraph points to [the types above](#types), which stays a link because it is prose.

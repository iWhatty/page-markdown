// Shared spelling aliases: identical DOM operations, smaller main bundle.
// Like the existing walk aliases, these add no per-capture state or reads.
export const DOM_GET_ATTRIBUTE = 'getAttribute';
export const DOM_SET_ATTRIBUTE = 'setAttribute';
export const DOM_HAS_ATTRIBUTE = 'hasAttribute';
export const DOM_REMOVE_ATTRIBUTE = 'removeAttribute';
export const DOM_QUERY_SELECTOR = 'querySelector';
export const DOM_QUERY_SELECTOR_ALL = 'querySelectorAll';
export const DOM_TEXT_CONTENT = 'textContent';
export const DOM_DOCUMENT_ELEMENT = 'documentElement';
export const DOM_FIRST_ELEMENT_CHILD = 'firstElementChild';
export const DOM_INNER_HTML = 'innerHTML';
export const DOM_CREATE_ELEMENT = 'createElement';

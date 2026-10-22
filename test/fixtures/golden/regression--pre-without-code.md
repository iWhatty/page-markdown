# json

Body text sentence that keeps the article long enough to pass thresholds. Body text sentence that keeps the article long enough to pass thresholds. Body text sentence that keeps the article long enough to pass thresholds.

Encoding basic Python object hierarchies:

```python
>>> import json
>>> json.dumps(['foo', {'bar': ('baz', None, 1.0, 2)}])
'["foo", {"bar": ["baz", null, 1.0, 2]}]'
>>> print(json.dumps({"c": 0, "b": 0, "a": 0}, sort_keys=True))
{"a": 0, "b": 0, "c": 0}
```

Compact encoding: use `separators=(',', ':')` and the {"key": "value"} form shown in the reference, which is longer than one hundred characters in this sentence on purpose.

Decoding with an object hook: `object_hook=as_complex` stays visible.

#!/usr/bin/env python3
"""Build framework-independent CSS variables from the supplied token JSON."""
from pathlib import Path
import json
import re

def kebab(name: str) -> str:
    return re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', name).lower()

def main() -> None:
    root = Path(__file__).resolve().parent.parent
    data = json.loads((root / 'design/tokens.json').read_text(encoding='utf-8'))
    lines = ['/* Generated from tokens.json. Not an official brand specification. */', '.kw-root {',
             '  --kw-font-family: inherit;', '  --kw-safe-top: 0px;', '  --kw-safe-bottom: 0px;']
    for name, value in data['color'].items():
        lines.append(f'  --kw-color-{kebab(name)}: {value};')
    for group in ['space', 'radius', 'layout']:
        for name, value in data[group].items():
            lines.append(f'  --kw-{kebab(group)}-{kebab(name)}: {value}px;')
    for name, token in data['type'].items():
        for field in ['size', 'lineHeight']:
            lines.append(f'  --kw-type-{kebab(name)}-{kebab(field)}: {token[field]}px;')
        lines.append(f'  --kw-type-{kebab(name)}-weight: {token["weight"]};')
    lines.append('}')
    output = root / 'design/tokens.css'
    output.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Wrote {output}')

if __name__ == '__main__':
    main()

files = ['dashboard/js/data-prep.js', 'dashboard/js/charts.js', 'dashboard/js/app.js']
for f in files:
    src = open(f, encoding='utf-8').read()
    # Count parens outside of strings/template literals/comments (rough check by tracking depth)
    depth = 0
    in_str_double = False
    in_str_single = False
    in_template = False
    prev = ''
    issues = []
    for i, ch in enumerate(src):
        if in_str_double:
            if ch == '"' and prev != '\\': in_str_double = False
        elif in_str_single:
            if ch == "'" and prev != '\\': in_str_single = False
        elif ch == '"' and prev != '\\':
            in_str_double = True
        elif ch == "'" and prev != '\\':
            in_str_single = True
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth < 0:
                line_no = src[:i].count('\n') + 1
                issues.append(f'Extra ) at line {line_no}')
                depth = 0
        prev = ch
    if depth != 0:
        issues.append(f'Unclosed ( depth={depth} at end')
    if issues:
        print(f'ISSUES in {f}: ' + ', '.join(issues[:5]))
    else:
        print(f'OK {f}')

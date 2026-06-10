# GDB Python

Use short GDB Python blocks when native commands become repetitive or hard to parse. Print stable labels.

Evaluate several expressions:

```gdb
python
exprs = ["count", "total", "items[count-1].name", "items[count-1].penalty"]
for expr in exprs:
    try:
        print(f"{expr} = {gdb.parse_and_eval(expr)}")
    except gdb.error as e:
        print(f"{expr} = <error: {e}>")
end
```

Print the current frame summary:

```gdb
python
frame = gdb.selected_frame()
print(f"frame={frame.name()}")
for sym in frame.block():
    if sym.is_argument or sym.is_variable:
        try:
            print(f"{sym.name} = {sym.value(frame)}")
        except Exception as e:
            print(f"{sym.name} = <error: {e}>")
end
```

Define a temporary custom command for repeated snapshots:

```gdb
python
class LiteSnapshot(gdb.Command):
    def __init__(self):
        super(LiteSnapshot, self).__init__("lite_snapshot", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        print("=== lite_snapshot ===")
        gdb.execute("frame")
        gdb.execute("info args")
        gdb.execute("info locals")
        print("=== end_snapshot ===")

LiteSnapshot()
end
lite_snapshot
```

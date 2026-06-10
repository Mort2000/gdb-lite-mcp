# Memory Corruption

Goal: find the write that changes a value unexpectedly.

Use watchpoints instead of guessing:

```gdb
break after_initialization
run
watch target_value
continue
bt
frame
info locals
```

For struct fields:

```gdb
watch object.field
watch object->field
```

For raw memory:

```gdb
watch *(int*)address
continue
x/32bx address
x/16gx address
```

If the value is in an array, first break after allocation/initialization and print the address:

```gdb
print &items[index].field
watch items[index].field
```

When a watchpoint hits inside a library function, inspect the caller frames to identify the project-level write.

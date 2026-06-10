# Using Hotkeys with TypeScript in VS Code Extensions

This document explains how to use the hotkey system with TypeScript's type system to get better autocompletion, type checking, and safer code.

## Type Definitions for Hotkeys

While the hotkey system works with plain strings, defining proper TypeScript types provides significant benefits:

```typescript
// Define type-safe scopes
export type MyHotkeyScope = 'global' | 'editor' | 'resultPanel';

// Define type-safe commands
export type MyHotkeyCommand = 'Execute' | 'Save' | 'Cancel' | 'Refresh';
```

## Benefits of Typed Hotkeys

1. **Autocomplete**: IDE suggests valid scope and command values
2. **Type Checking**: Prevents typos and invalid command references
3. **Refactoring Support**: Rename commands across your codebase safely
4. **Better Documentation**: Improves code readability

## Typing Hotkey Mappings

Apply your types to hotkey mappings:

```typescript
import { type HotkeyMapping } from '../../common/hotkeys';

// Apply command type to hotkey mappings
export const EditorHotkeys: HotkeyMapping<MyHotkeyCommand>[] = [
  {
    key: 'f5',
    command: 'Execute', // Autocomplete works here
    description: 'Execute action',
    shortcutDisplay: { windows: 'F5', mac: 'F5' }
  }
  // More hotkeys...
] as const;
```

## Using Typed Hooks

Pass your types to hooks to enable type checking:

```typescript
// Register a typed scope
useHotkeyScope<MyHotkeyScope, MyHotkeyCommand>(
  'editor', // IDE validates this is a valid scope
  EditorHotkeys
);

// Register a typed command handler
useCommandHotkey<MyHotkeyScope, MyHotkeyCommand>(
  'editor', // Valid scope autocompleted
  'Execute', // Valid command autocompleted
  (event) => {
    // Handle command
  }
);
```

## Working with HotkeyCommandService

The service is the runtime registry that connects scope listeners (`useHotkeyScope`) to command
handlers (`useCommandHotkey`). You normally do not touch it directly — the hooks do. To display a
shortcut in the UI, use the pure `getShortcutDisplay` helper instead (see below); it reads the static
mapping arrays and needs no runtime state.

## Practical Example

```typescript
// Define types
export type EditorHotkeyScope = 'global' | 'editor';
export type EditorHotkeyCommand = 'Save' | 'Execute' | 'Cancel';

// Define typed hotkeys
export const GlobalHotkeys: HotkeyMapping<EditorHotkeyCommand>[] = [
    {
        key: 'mod+s',
        command: 'Save', // TypeScript validates this
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    }
] as const;

// Use with typed components
const EditorComponent = () => {
    // Register scope with proper types
    useHotkeyScope<EditorHotkeyScope, EditorHotkeyCommand>('global', GlobalHotkeys);

    // Register command handler with proper types
    useCommandHotkey<EditorHotkeyScope, EditorHotkeyCommand>(
        'global', // IDE validates this is a valid scope
        'Save',   // IDE validates this is a valid command
        (event) => {
            // Handler code
        }
    );

    return (/* Component JSX */);
};
```

## Type Errors Caught by TypeScript

With proper typing, TypeScript will catch these errors:

```typescript
// Error: 'nonexistentScope' is not assignable to type 'EditorHotkeyScope'
useHotkeyScope<EditorHotkeyScope, EditorHotkeyCommand>('nonexistentScope', GlobalHotkeys);

// Error: 'NonExistentCommand' is not assignable to type 'EditorHotkeyCommand'
useCommandHotkey<EditorHotkeyScope, EditorHotkeyCommand>('global', 'NonExistentCommand', () => {});
```

## Type Safety for Shortcut Display

Use the pure `getShortcutDisplay` helper to safely access shortcut displays. Pass the specific
scope's mapping array so that commands shared across scopes resolve unambiguously:

```typescript
import { getShortcutDisplay } from '../../common/hotkeys';

const saveShortcut = useMemo(() => {
  // Type-checked - IDE suggests valid commands for the given mapping array
  const shortcut = getShortcutDisplay(GlobalHotkeys, 'Save');
  return shortcut ? ` (${shortcut})` : '';
}, []);
```

Proper typing makes your hotkey system more maintainable and less error-prone while improving the development experience with better IDE support.

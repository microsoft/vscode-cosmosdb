# Using Hotkeys in VS Code Extensions

This document explains how to use the hotkey system for registering and handling keyboard shortcuts in VS Code extensions.

## Core Concepts

### Scopes

Hotkeys are organized into scopes that determine where keyboard shortcuts are active:

- **Global Scope**: Always active throughout the application
- **Component-Specific Scopes**: Active only within specific components

### Key Concepts

- **Hotkey Mapping**: Defines a keyboard shortcut, the command it triggers, and its display text
- **Hotkey Command**: The action triggered by a keyboard shortcut
- **Command Handler**: The function executed when a hotkey is pressed

## Defining Hotkeys

Define hotkeys as mappings between keyboard shortcuts and commands:

```typescript
export const MyHotkeys: HotkeyMapping<MyHotkeyCommand>[] = [
  {
    key: 'f5',
    command: 'ExecuteAction',
    description: 'Execute action',
    shortcutDisplay: { windows: 'F5', mac: 'F5' },
  },
  {
    key: 'mod+s',
    command: 'SaveAction',
    description: 'Save changes',
    shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
  },
] as const;
```

## Registering Hotkey Scopes

### Global Scope

Register global hotkeys that work throughout the application:

```typescript
import { useHotkeyScope } from '../../common/hotkeys';

const MyComponent = () => {
    // Register global hotkeys
    useHotkeyScope<MyHotkeyScope, MyHotkeyCommand>('global', GlobalHotkeys);

    return (
        // Your component content
    );
};
```

### Component-Specific Scopes

Register scopes that are active only within specific components:

```typescript
const MyComponentWithScope = () => {
    // Register component-specific hotkeys
    const scopeRef = useHotkeyScope<MyHotkeyScope, MyHotkeyCommand>('editorScope', EditorHotkeys);

    return (
        <div ref={scopeRef}>
            {/* Hotkeys will be active within this element */}
        </div>
    );
};
```

## Handling Hotkey Commands

Use `useCommandHotkey` to register handlers for specific commands:

```typescript
import { useCommandHotkey } from '../../common/hotkeys';

const MyActionHandler = () => {
    // State and other logic
    const [isDisabled, setIsDisabled] = useState(false);

    // Handle the ExecuteAction command in the global scope
    useCommandHotkey<MyHotkeyScope, MyHotkeyCommand>(
        'global',
        'ExecuteAction',
        async (event) => {
            // Prevent default behavior
            event.preventDefault();

            // Execute your action
            await executeMyAction();
        },
        { disabled: isDisabled }
    );

    return (
        // Your component content
    );
};
```

## Conditional Enabling/Disabling

You can conditionally enable or disable hotkey handlers:

```typescript
// Disable based on component state
useCommandHotkey<MyHotkeyScope, MyHotkeyCommand>('editorScope', 'SaveAction', handleSave, {
  disabled: !isDirty || isProcessing,
});
```

## Displaying Hotkeys in UI

Get the shortcut display text for tooltips or UI elements:

```typescript
import { HotkeyCommandService } from '../../common/hotkeys';

const shortcutText = useMemo(() => {
    const title = HotkeyCommandService.getInstance<MyHotkeyScope, MyHotkeyCommand>()
        .getShortcutDisplay('global', 'SaveAction');
    return title ? ` (${title})` : '';
}, []);

// Use in UI
return (
    <Tooltip content={`Save file${shortcutText}`}>
        <Button onClick={handleSave}>Save</Button>
    </Tooltip>
);
```

## Best Practices

1. **Define Type Safety**:

   ```typescript
   export type MyHotkeyScope = 'global' | 'editorScope' | 'resultPanel';
   export type MyHotkeyCommand = 'Save' | 'Execute' | 'Cancel';
   ```

2. **Organize by Component**:
   - Keep hotkey definitions near the components that use them
   - Group related hotkeys in the same scope

3. **Provide Consistent Experience**:
   - Use platform-specific key displays (Windows/Mac)
   - Follow VS Code keyboard shortcut conventions

4. **Prevent Event Propagation** when handling hotkeys to avoid triggering multiple actions

## Complete Example

```typescript
// Define types
export type MyHotkeyScope = 'global' | 'editor';
export type MyHotkeyCommand = 'Save' | 'Execute';

// Define hotkeys
export const GlobalHotkeys: HotkeyMapping<MyHotkeyCommand>[] = [
    {
        key: 'mod+s',
        command: 'Save',
        description: 'Save document',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    }
] as const;

// Component using hotkeys
const MyComponent = () => {
    const [isDirty, setIsDirty] = useState(false);

    // Register scope
    useHotkeyScope<MyHotkeyScope, MyHotkeyCommand>('global', GlobalHotkeys);

    // Handle command
    useCommandHotkey<MyHotkeyScope, MyHotkeyCommand>(
        'global',
        'Save',
        async (event) => {
            event.preventDefault();
            await saveDocument();
            setIsDirty(false);
        },
        { disabled: !isDirty }
    );

    return (
        // Component content
    );
};
```

---
name: accessibility-aria-expert
description: Detects and fixes accessibility issues in React/Fluent UI webviews. Use when reviewing code for screen reader compatibility, fixing ARIA labels, ensuring keyboard navigation, adding live regions for status messages, or managing focus in dialogs.
---

# Accessibility Expert for Webviews

Verify and fix accessibility in React/Fluent UI webview components.

## When to Use

- Review webview code for accessibility issues
- Fix double announcements from screen readers
- Add missing `aria-label` to icon-only buttons or form inputs
- Make tooltips accessible to keyboard/screen reader users
- Announce status changes (loading, search results, errors)
- Manage focus when dialogs/modals open
- Group related controls with proper labels

## Core Pattern: Tooltip Accessibility

Tooltips require `aria-label` + `aria-hidden` to avoid double announcements:

```tsx
<Tooltip content="Detailed explanation">
  <Badge tabIndex={0} className="focusableBadge" aria-label="Badge text. Detailed explanation">
    <span aria-hidden="true">Badge text</span>
  </Badge>
</Tooltip>
```

- `aria-label`: Full context (visible text + tooltip)
- `aria-hidden="true"`: Wraps visible text to prevent duplication
- Screen reader hears: "Badge text. Detailed explanation"

## Required Accessible-Name Audit

For every interactive element with visible text, compare the rendered text with its computed accessible name. Check all
sources that can override descendant text, including `aria-label`, `aria-labelledby`, `title`, and Fluent UI tooltips with
`relationship="label"`.

- The computed accessible name must contain the exact localized visible text. Additional context may follow or precede it.
- Prefer visible descendant text as the native accessible name. For a simple flat-text description, use `aria-description` so
  the visible label remains the name without adding hidden DOM content. Use `aria-describedby` when the description already
  exists in the DOM, is shared by multiple controls, contains meaningful structure, or compatibility requirements demand it.
  Add `aria-label` only when the accessible name itself needs clarification, and include the exact visible label when doing so.
- When adding context, derive both strings from the same localized visible-label variable. Do not translate the visible and
  accessible labels independently because translations can drift.
- Remember that `aria-label` overrides descendant text. Seeing the visible label inside the component does not mean it is
  included in the accessibility tree.
- Review existing accessible-name attributes when modifying a control, even when the change does not add or alter ARIA.

For user-facing controls covered by Playwright, assert both the rendered label and computed accessible name:

```tsx
const moreLabel = page.getByRole('button', { name: /^More/ });
await expect(moreLabel).toHaveText('More…');
await expect(moreLabel).toHaveAccessibleName(/^More…/);
await expect(moreLabel).toHaveAccessibleDescription('Show full description');
```

## Avoid Hidden-Text Scroll Regressions

Do not add an absolutely positioned screen-reader-only element just to name a nearby semantic element, especially inside a
scrollable table, grid, list, or panel. VoiceOver may move the virtual cursor to the hidden element's layout box and scroll the
visible content out of view.

Prefer setting the accessible name or description on a rendered element with useful on-screen bounds. For text controls, this is
usually the semantic element itself. For an icon or symbol inside a table cell, use a visible inline wrapper as the named
accessibility node and keep the visual-only child hidden from assistive technology:

```tsx
// ❌ VoiceOver may scroll to the hidden span when navigating the cell.
<td>
  <span className={styles.srOnly}>{l10n.t('Yes')}</span>
  <CheckmarkCircleFilled />
</td>

// ❌ The value is announced, but VoiceOver's visual focus indicator may disappear from the rendered symbol.
<td aria-label={l10n.t('Yes')}>
  <CheckmarkCircleFilled aria-hidden={true} />
</td>

// ✅ The accessibility node uses the visible symbol's bounds; there is no off-screen layout box to reveal.
<td>
  <span role="img" aria-label={l10n.t('Yes')} style={{ display: 'inline-flex' }}>
    <CheckmarkCircleFilled aria-hidden={true} />
  </span>
</td>
```

Use hidden DOM text only when the semantic relationship cannot be expressed directly. When it is necessary, use an established
shared utility, anchor it to an appropriate containing block, and manually navigate the control with VoiceOver or NVDA to verify
that focus and the virtual cursor do not scroll the visible content away or lose the visual focus indicator. Playwright
accessible-name assertions do not detect these screen-reader-driven visual regressions.

## Detection Rules

### 1. Tooltip Without aria-label Context

❌ **Problem**: Tooltip content inaccessible to screen readers

```tsx
<Tooltip content="Save document to database">
  <Button aria-label="Save">Save</Button>
</Tooltip>
```

✅ **Fix**: Include tooltip in aria-label

```tsx
<Tooltip content="Save document to database" relationship="description">
  <Button aria-label="Save document to database">Save</Button>
</Tooltip>
```

### 2. Missing aria-hidden (Double Announcement)

❌ **Problem**: Screen reader says "Collection scan Collection scan"

```tsx
<Badge aria-label="Collection scan. Query is inefficient">Collection scan</Badge>
```

✅ **Fix**: Wrap visible text

```tsx
<Badge aria-label="Collection scan. Query is inefficient">
  <span aria-hidden="true">Collection scan</span>
</Badge>
```

### 3. Redundant aria-label (NOT Needed)

❌ **Problem**: aria-label identical to visible text adds no value

```tsx
<Button aria-label="Save">Save</Button>
<ToolbarButton aria-label="Validate" icon={<CheckIcon />}>Validate</ToolbarButton>
```

✅ **Fix**: Remove redundant aria-label OR make it more descriptive

```tsx
<Button>Save</Button>
<ToolbarButton icon={<CheckIcon />}>Validate</ToolbarButton>
```

**Keep aria-label only when it adds information:**

```tsx
<ToolbarButton aria-label="Save document to database" icon={<SaveIcon />}>
  Save
</ToolbarButton>
```

### 4. Icon-Only Button Missing aria-label

❌ **Problem**: No accessible name

```tsx
<ToolbarButton icon={<DeleteRegular />} onClick={onDelete} />
```

✅ **Fix**: Add aria-label

```tsx
<Tooltip content="Delete selected items" relationship="description">
  <ToolbarButton aria-label="Delete selected items" icon={<DeleteRegular />} onClick={onDelete} />
</Tooltip>
```

### 5. Decorative Elements Not Hidden

❌ **Problem**: Progress bar announced unnecessarily

```tsx
<ProgressBar thickness="large" />
```

✅ **Fix**: Hide decorative elements

```tsx
<ProgressBar thickness="large" aria-hidden={true} />
```

### 6. Input Missing Accessible Name

❌ **Problem**: SpinButton/Input without accessible name

```tsx
<SpinButton value={skipValue} onChange={onSkipChange} />
<Input placeholder="Enter query..." />
```

✅ **Fix**: Add aria-label or associate with label element

```tsx
<SpinButton aria-label="Skip documents" value={skipValue} onChange={onSkipChange} />
<Label htmlFor="query-input">Query</Label>
<Input id="query-input" placeholder="Enter query..." />
```

### 7. Visible Label Not in Accessible Name

❌ **Problem**: aria-label doesn't contain visible text (breaks voice control)

```tsx
<ToolbarButton aria-label="Reload data" icon={<RefreshIcon />}>
  Refresh
</ToolbarButton>
```

✅ **Fix**: Accessible name must contain visible label exactly

```tsx
<ToolbarButton aria-label="Refresh data" icon={<RefreshIcon />}>
  Refresh
</ToolbarButton>
```

Voice control users say "click Refresh" – only works if accessible name contains "Refresh".

### 8. Status Changes Not Announced

❌ **Problem**: Screen reader doesn't announce dynamic content

```tsx
<span>{isLoading ? 'Loading...' : `${count} results`}</span>
```

✅ **Fix**: Use the `Announcer` component

```tsx
import { Announcer } from '../../api/webview-client/accessibility';

// Announces when `when` transitions from false to true
<Announcer when={isLoading} message={l10n.t('Loading...')} />

// Dynamic message based on state
<Announcer
    when={!isLoading && documentCount !== undefined}
    message={documentCount > 0 ? l10n.t('Results found') : l10n.t('No results found')}
/>
```

Use for: loading states, search results, success/error messages.

### 9. Dialog Opens Without Focus Move

❌ **Problem**: Focus stays on trigger when modal opens

```tsx
{
  isOpen && <Dialog>...</Dialog>;
}
```

✅ **Fix**: Move focus programmatically

```tsx
const dialogRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (isOpen) dialogRef.current?.focus();
}, [isOpen]);

{
  isOpen && (
    <Dialog ref={dialogRef} tabIndex={-1} aria-modal="true">
      ...
    </Dialog>
  );
}
```

### 10. Related Controls Without Group Label

❌ **Problem**: Buttons share visual label but screen reader misses context

```tsx
<span>How would you rate this?</span>
<Button>👍</Button>
<Button>👎</Button>
```

✅ **Fix**: Use role="group" with aria-labelledby

```tsx
<div role="group" aria-labelledby="rating-label">
  <span id="rating-label">How would you rate this?</span>
  <Button aria-label="I like it">👍</Button>
  <Button aria-label="I don't like it">👎</Button>
</div>
```

## When to Use aria-hidden

**DO use** on:

- Visible text when aria-label provides complete context
- Decorative icons, spinners, progress bars
- Visual separators (\`|\`, \`—\`)

**DO NOT use** on:

- The only accessible content (hides it completely)
- Interactive/focusable elements
- Error messages or alerts

## focusableBadge Pattern

For keyboard-accessible badges with tooltips:

1. Import: \`import '../components/focusableBadge/focusableBadge.scss';\`
2. Apply attributes:

```tsx
<Badge tabIndex={0} className="focusableBadge" aria-label="Visible text. Tooltip details">
  <span aria-hidden="true">Visible text</span>
</Badge>
```

## Screen Reader Announcements

Use the `Announcer` component for WCAG 4.1.3 (Status Messages) compliance.

```tsx
import { Announcer } from '../../api/webview-client/accessibility';
```

### Basic Usage

```tsx
// Announces "AI is analyzing..." when isLoading becomes true
<Announcer when={isLoading} message={l10n.t('AI is analyzing...')} />

// Dynamic message based on state (e.g., query results)
<Announcer
    when={!isLoading && documentCount !== undefined}
    message={documentCount > 0 ? l10n.t('Results found') : l10n.t('No results found')}
/>

// With assertive politeness (default is polite)
<Announcer when={hasError} message={l10n.t('Error occurred')} politeness="assertive" />
```

### Props

- `when`: Announces when this transitions from `false` to `true`
- `message`: The message to announce (use `l10n.t()` for localization)
- `politeness`: `'assertive'` (default, interrupts) or `'polite'` (waits for idle)

### Key Points

- **Placement doesn't matter** - screen readers monitor all live regions regardless of DOM position; place near related UI for code readability
- **Store relevant state** (e.g., `documentCount`) to derive dynamic messages
- **Use `l10n.t()` for messages** - announcements must be localized
- **Condition resets automatically** - when `when` goes back to `false`, it's ready for the next announcement
- **Prefer 'assertive'** for user-initiated actions, 'polite' for background updates

## Quick Checklist

- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have associated labels or `aria-label`
- [ ] Tooltip content included in `aria-label`
- [ ] Visible text wrapped in `aria-hidden="true"` when aria-label duplicates it
- [ ] Redundant aria-labels removed (identical to visible text)
- [ ] Accessible names contain the exact localized visible label (for voice control)
- [ ] VoiceOver/NVDA navigation neither scrolls visible content away nor loses its visual focus indicator
- [ ] Decorative elements have `aria-hidden={true}`
- [ ] Badges with tooltips use `focusableBadge` class + `tabIndex={0}`
- [ ] Status updates use `Announcer` component
- [ ] Focus moves to dialog/modal content when opened
- [ ] Related controls wrapped in `role="group"` with `aria-labelledby`

## References

- [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html)
- [WCAG 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html)
- [WCAG 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG21/Understanding/label-in-name.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html)
- [WCAG 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html)
- See `src/webviews/components/focusableBadge/focusableBadge.md` for the Badge pattern

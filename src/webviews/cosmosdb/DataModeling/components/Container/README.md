# `Container`

A container lays out a surface that fills its window: a header and content that scroll, above an
action bar pinned to the bottom. The action bar gains a border and a shadow while there is more
content below the fold, and loses them again when there is not.

A container is composed from its family. `Container` is the root, `ContainerBody` is the scroll
region and the content column inside it, `ContainerHeader`, `ContainerNav` and `ContainerMain` are
the three regions the body holds, `ContainerSection` is a titled block of content, and
`ContainerFooter` is the action bar.

Use a container when the surface is the whole window. For content layered above an existing page,
use Fluent's `Dialog` or `Drawer` instead.

## Best practices

### Do

- Give `ContainerBody` all three regions, or override `grid-template-areas` through `className`.
- Keep every scrolling concern inside `ContainerBody`. It is the only scroll container.
- Pass `focusOnMount` on the section a step change mounts, and give it a `key` that changes with
  the step.
- Use `className` when a surface needs a different content width. None of the metrics are public
  API yet.

### Don't

- Nest a second scroll container inside the body. The action bar measures the outer one.
- Rely on a region you did not render. Each declared region reserves its grid row, so omitting one
  leaves that row's gap behind.
- Add `aria-label` to `ContainerMain`. It is the `main` landmark, and the surface has one.

## Anatomy

```tsx
<Container>
    <ContainerBody navPosition="top">
        <ContainerHeader media={<RocketRegular />} title="…" subtitle="…" action={…} />
        <ContainerNav>{/* a StepList */}</ContainerNav>
        <ContainerMain>
            <ContainerSection title="…" subtitle="…" focusOnMount>…</ContainerSection>
        </ContainerMain>
    </ContainerBody>
    <ContainerFooter note="…" contentEnd={<Button>Learn more</Button>}>
        <Button appearance="primary">Start</Button>
        <Button>Back</Button>
    </ContainerFooter>
</Container>
```

## The layout contract

| Member             | Renders                     | Owns                                                                       |
| ------------------ | --------------------------- | -------------------------------------------------------------------------- |
| `Container`        | `<div>`                     | the full-height column, the positioning context, and the shared state      |
| `ContainerBody`    | `<div>` › `<div>`           | the only scroll region, and the content grid inside it                     |
| `ContainerHeader`  | `<div>`, grid area `header` | media, title, subtitle, end-aligned action                                 |
| `ContainerNav`     | `<div>`, grid area `nav`    | placement, and the `min-width: 0` a nested overflow control needs          |
| `ContainerMain`    | `<main>`, grid area `main`  | the current step's content, as a column                                    |
| `ContainerSection` | `<section>`                 | a titled block, its `aria-labelledby`, and optional focus-on-mount         |
| `ContainerFooter`  | `<div>`                     | the pinned action bar, and its own elevation while the body has more below |

Three things are shared through context rather than wired by the consumer:

- **`ContainerBody` measures its own overflow**, on scroll, on resize, and after every render.
  `ContainerFooter` reads that and elevates itself. No refs, no `ResizeObserver`, no `onScroll`.
- **`Container` records its own first paint**, so `ContainerSection focusOnMount` can skip it.
- Used outside a `Container`, every member still renders. It degrades to never-elevated and
  always-focus-on-mount rather than throwing.

## Why the header is a child of the body

Because it scrolls away. Only the footer is pinned, and that is deliberate: on a page-scale surface
the identifying block has done its job once the user has read it, and the vertical space is better
spent on content.

A consumer who wants a pinned header puts `ContainerHeader` directly under `Container` instead.
`flex-shrink: 0` makes that work with no extra API. Both positions are supported.

## Regions, not grid areas on the content

`ContainerNav` and `ContainerMain` look like one nesting level too many until you try the
alternative. Carrying `grid-area` on the content itself, which is what Fluent's own `MessageBar`
does, works only while each region holds exactly one element. Give a step two sections and both
land in the `main` area and overlap.

Each region being one grid item is what makes it its own column and lets it hold any number of
children.

## Accessibility

- `ContainerMain` is the `main` landmark.
- `ContainerSection` generates a heading id and points its own `aria-labelledby` at it, so each
  section is a named region.
- `focusOnMount` gives the heading `tabIndex = -1` and focuses it, which is WCAG 2.4.3 for a step
  change. It is suppressed on the container's first render: arriving at a surface is not a
  navigation, and stealing focus there fights whatever the consumer focused deliberately.
- Fluent's own `Drawer` guidance applies to `ContainerBody` too: a scroll region with no focusable
  content needs `tabIndex={0}` for keyboard scroll access.

## Props

See [`Container.types.ts`](./Container.types.ts). Every prop carries its own JSDoc, which is what
your editor shows on hover; this file deliberately does not restate it, because a hand-written props
table is wrong within two changes and is worse than nothing, because it is believed.

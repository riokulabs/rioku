# `<LoadingState>`

Renders a Mantine `<Skeleton>` layout while content is being fetched.

## What it is for

- Full-section or full-page loading placeholders that match the expected content shape
- Replacing a table, detail card, or list while data loads

## What it is NOT for

- Inline button spinners (use `loading` prop on Mantine `<Button>`)
- Small inline loaders (use `<Loader>` directly)
- Error states (use `<ErrorState>`)

## Shapes

| `shape`          | Layout                                              |
| ---------------- | --------------------------------------------------- |
| `list` (default) | N rows of 48px height                               |
| `detail`         | One large 120px header + 3 body rows                |
| `table`          | One header-height row + N body rows of equal height |

## Props

| Prop    | Type                            | Default  | Description                                   |
| ------- | ------------------------------- | -------- | --------------------------------------------- |
| `rows`  | `number`                        | `5`      | Row count (used by `list` and `table` shapes) |
| `shape` | `'list' \| 'detail' \| 'table'` | `'list'` | Skeleton layout                               |

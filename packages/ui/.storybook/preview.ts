import type { Preview } from '@storybook/react'
import '../src/theme/tokens.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#09090b' },
        { name: 'light', value: '#fafafa' },
      ],
    },
  },
}
export default preview

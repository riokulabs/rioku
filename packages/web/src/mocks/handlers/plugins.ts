import { http, HttpResponse } from 'msw'
import { mockPlugins } from '../data/plugins'

export const pluginsHandlers = [
  http.get('/api/v1/plugins', () => {
    return HttpResponse.json(mockPlugins)
  }),

  http.get('/api/v1/plugins/:id', ({ params }) => {
    const plugin = mockPlugins.find((p) => p.id === params.id)
    if (!plugin) {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: 'Plugin not found',
          instance: `/plugins/${params.id}`,
        },
        { status: 404 },
      )
    }
    return HttpResponse.json(plugin)
  }),
]

import { http, HttpResponse } from 'msw'
import { mockNodes } from '../data/nodes'

export const clusterHandlers = [
  http.get('/api/v1/cluster/nodes', () => {
    return HttpResponse.json(mockNodes)
  }),
]

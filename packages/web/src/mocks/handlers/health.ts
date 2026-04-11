import { http, HttpResponse } from 'msw'
import { mockHealthStatus } from '../data/health'

export const healthHandlers = [
  http.get('/api/v1/health', () => {
    return HttpResponse.json(mockHealthStatus)
  }),
]

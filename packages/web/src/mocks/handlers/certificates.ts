import { http, HttpResponse } from 'msw'
import { mockCertificates } from '../data/certificates'

export const certificatesHandlers = [
  http.get('/api/v1/certificates', () => {
    return HttpResponse.json(mockCertificates)
  }),
]

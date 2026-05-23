import { api } from './client'
import type { MqttBroker, MqttBrokerPayload } from '../types'

export const mqttApi = {
  list:   () => api.get<MqttBroker[]>('/mqtt/brokers'),
  get:    (id: number) => api.get<MqttBroker>(`/mqtt/brokers/${id}`),
  create: (data: MqttBrokerPayload) => api.post<MqttBroker>('/mqtt/brokers', data),
  update: (id: number, data: Partial<MqttBrokerPayload>) =>
    api.patch<MqttBroker>(`/mqtt/brokers/${id}`, data),
  delete: (id: number) => api.delete(`/mqtt/brokers/${id}`),
  test:   (id: number) => api.post<{ ok: boolean; message: string }>(`/mqtt/brokers/${id}/test`),
}

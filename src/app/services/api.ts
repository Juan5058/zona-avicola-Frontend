// servicio central HTTP
import { Injectable } from '@angular/core';
import { AuthService } from './auth';
import { config } from '../config';

const API = config.apiUrl;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private auth: AuthService) {}

  private h() {
    return this.auth.authHeaders();
  }

  async get<T>(path: string): Promise<T> {
    const r = await fetch(`${API}${path}`, { headers: this.h() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async post<T>(path: string, body: any): Promise<T> {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async put<T>(path: string, body: any): Promise<T> {
    const r = await fetch(`${API}${path}`, {
      method: 'PUT',
      headers: this.h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async patch<T>(path: string, body: any = {}): Promise<T> {
    const r = await fetch(`${API}${path}`, {
      method: 'PATCH',
      headers: this.h(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async delete<T>(path: string): Promise<T> {
    const r = await fetch(`${API}${path}`, { method: 'DELETE', headers: this.h() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async postLogin(body: any): Promise<any> {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('credenciales invalidas');
    return r.json();
  }

  async getBlobReport(path: string): Promise<Blob> {
    const r = await fetch(`${API}${path}`, { headers: this.h() });
    if (!r.ok) throw new Error(await r.text());
    return r.blob();
  }
}
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface Toast {
  msg: string;
  type: 'success' | 'error' | 'warning' | 'info';
  id: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts$ = new Subject<Toast>();
  toasts$ = this._toasts$.asObservable();
  private counter = 0;

  show(msg: string, type: Toast['type'] = 'success') {
    this._toasts$.next({ msg, type, id: ++this.counter });
  }
  success(msg: string) {
    this.show(msg, 'success');
  }
  error(msg: string) {
    this.show(msg, 'error');
  }
  warning(msg: string) {
    this.show(msg, 'warning');
  }
  info(msg: string) {
    this.show(msg, 'info');
  }
}

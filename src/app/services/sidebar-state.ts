import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SidebarStateService {
  collapsed = signal<boolean>(false);

  toggle() {
    this.collapsed.update((v) => !v);
  }

  set(val: boolean) {
    this.collapsed.set(val);
  }
}

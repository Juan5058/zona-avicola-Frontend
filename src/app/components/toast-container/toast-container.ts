import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, Toast } from '../../services/toast';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div id="toast-container">
      <div *ngFor="let t of toasts" class="toast {{ t.type }}">
        <span>{{ icons[t.type] }}</span
        ><span>{{ t.msg }}</span>
      </div>
    </div>
  `,
})
export class ToastContainerComponent implements OnInit {
  toasts: Toast[] = [];
  icons: Record<string, string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  constructor(private toastService: ToastService) {}

  ngOnInit() {
    this.toastService.toasts$.subscribe((t) => {
      this.toasts.push(t);
      setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== t.id)), 2800);
    });
  }
}

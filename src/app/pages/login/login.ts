// componente login
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../services/auth';
import { ApiService } from '../../services/api';
import { SVG_UI_USER, SVG_UI_LOCK, SVG_UI_EYE, SVG_UI_EYE_OFF, SVG_UI_WARNING } from '../../components/shared/ui-icons';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  host: { class: 'block fixed inset-0 z-[1000] overflow-hidden' },
})
export class LoginComponent {
  username     = '';
  password     = '';
  showPass     = false;
  loading      = false;
  errorMsg     = '';
  errorVisible = false;
  wrapUserErr  = false;
  wrapPassErr  = false;

  // Iconos SVG (reemplazan los emojis 👤 🔒 🙈 👁 ⚠️), vienen de shared/ui-icons.ts
  svgUser:    SafeHtml;
  svgLock:    SafeHtml;
  svgEye:     SafeHtml;
  svgEyeOff:  SafeHtml;
  svgWarning: SafeHtml;

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    private sanitizer: DomSanitizer,
  ) {
    this.svgUser    = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_USER);
    this.svgLock    = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_LOCK);
    this.svgEye     = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_EYE);
    this.svgEyeOff  = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_EYE_OFF);
    this.svgWarning = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_WARNING);
  }

  clearError() {
    this.errorVisible = false;
    this.wrapUserErr  = false;
    this.wrapPassErr  = false;
  }

  showError(msg: string) {
    this.errorMsg     = msg;
    this.errorVisible = true;
  }

  onKeyUser(e: KeyboardEvent, passInput: HTMLInputElement) {
    if (e.key === 'Enter') passInput.focus();
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') this.doLogin();
  }

  // entrada sin cuenta — rol visitante local
  async entrarComoVisitante() {
    await this.auth.entrarComo();
    this.router.navigate(['/dashboard']);
  }

  async doLogin() {
    if (!this.username) {
      this.showError('Ingresa tu usuario');
      this.wrapUserErr = true;
      return;
    }
    if (!this.password) {
      this.showError('Ingresa tu contraseña');
      this.wrapPassErr = true;
      return;
    }
    this.loading = true;
    try {
      const data: any = await this.api.postLogin({
        nombre_usuario: this.username,
        contrasena:     this.password,
      });
      await this.auth.saveSession(data.access_token, data.usuario, data.rol);
      this.router.navigate(['/dashboard']);
    } catch {
      this.loading      = false;
      this.showError('Usuario o contraseña incorrectos');
      this.wrapUserErr  = true;
      this.wrapPassErr  = true;
      this.password     = '';
    }
  }
}

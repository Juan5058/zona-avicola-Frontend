import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClasificacionService } from '../clasificacion.service';

@Component({
  selector: 'app-clasificacion-auto',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auto.html',
  styleUrl: '../clasificacion.scss',
})
export class ClasificacionAutoComponent {
  constructor(public svc: ClasificacionService) {}
}
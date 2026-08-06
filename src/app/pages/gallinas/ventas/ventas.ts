import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GallinasService } from '../gallinas.service';

@Component({
  selector: 'app-gallinas-ventas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ventas.html',
  styleUrl: '../gallinas.scss',
})
export class VentasComponent {
  constructor(public svc: GallinasService) {}
}

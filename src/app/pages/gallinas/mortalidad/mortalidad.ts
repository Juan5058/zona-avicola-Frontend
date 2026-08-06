import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GallinasService } from '../gallinas.service';

@Component({
  selector: 'app-gallinas-mortalidad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mortalidad.html',
  styleUrl: '../gallinas.scss',
})
export class MortalidadComponent {
  constructor(public svc: GallinasService) {}
}

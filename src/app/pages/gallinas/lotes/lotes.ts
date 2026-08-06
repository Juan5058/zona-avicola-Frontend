import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GallinasService } from '../gallinas.service';

@Component({
  selector: 'app-gallinas-lotes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lotes.html',
  styleUrl: '../gallinas.scss',
})
export class LotesComponent {
  constructor(public svc: GallinasService) {}
}

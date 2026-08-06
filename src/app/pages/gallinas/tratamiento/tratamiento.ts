import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GallinasService } from '../gallinas.service';

@Component({
  selector: 'app-gallinas-tratamiento',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tratamiento.html',
  styleUrl: '../gallinas.scss',
})
export class TratamientoComponent {
  constructor(public svc: GallinasService) {}
}

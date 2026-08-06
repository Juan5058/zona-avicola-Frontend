import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConfiguracionService } from "../configuracion.service";

@Component({
  selector: "app-configuracion-catalogos",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./catalogos.html",
  styleUrl: "../configuracion.scss",
})
export class CatalogosComponent {
  constructor(public svc: ConfiguracionService) {}
}

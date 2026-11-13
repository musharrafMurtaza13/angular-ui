import { Component, signal } from '@angular/core';
import { DispatchBoardComponent } from './dispatchboard/dispatchboard';

@Component({
  imports: [DispatchBoardComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('dispatch-ui');
}

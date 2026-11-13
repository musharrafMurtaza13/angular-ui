import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription, timer, switchMap, filter } from 'rxjs';

interface AssignmentHistory {
  driverId: string;
  driverName: string;
  assignedAtUtc: string;
  note?: string;
}

interface Delivery {
  id: string;
  trackingCode: string;
  destination: string;
  promisedAtUtc: string;
  status: 'Pending' | 'Assigned' | 'InTransit' | 'Delivered';
  assignedDriverId?: string;
  assignedDriverName?: string;
  history: AssignmentHistory[];
  version: number;
  isLate: boolean;
  isAtRisk: boolean;
  driverUnavailableWarning: boolean;
}

interface Driver {
  id: string;
  name: string;
  availability: 'Available' | 'Busy' | 'Unavailable';
}

@Component({
  selector: 'app-dispatch-board',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dispatch-container">
      <header class="toolbar">
        <div>
          <h1>Dispatch Desk</h1>
          <span class="freshness-badge">
            Live sync (10s) · Last updated: {{ lastUpdated() | date:'HH:mm:ss' }}
          </span>
        </div>
        <button (click)="refreshNow()">Sync Now</button>
      </header>

      @if (feedbackBanner()) {
        <div class="alert" [class.error]="feedbackBanner()?.isError">
          {{ feedbackBanner()?.message }}
        </div>
      }

      <!-- Driver Roster Quick Toggle (to demonstrate driver becoming unavailable) -->
      <section class="driver-strip">
        <strong>Drivers:</strong>
        @for (drv of drivers(); track drv.id) {
          <span class="driver-pill" [class.unavailable]="drv.availability !== 'Available'">
            {{ drv.name }} ({{ drv.availability }})
            <button class="tiny-btn" (click)="toggleDriverSick(drv)">
              {{ drv.availability === 'Available' ? 'Mark Sick' : 'Mark Available' }}
            </button>
          </span>
        }
      </section>

      <!-- Dispatch Queue Table -->
      <table class="dispatch-table">
        <thead>
          <tr>
            <th>SLA / Urgency</th>
            <th>ID & Destination</th>
            <th>Promised By</th>
            <th>Status</th>
            <th>Assigned Driver</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (item of deliveries(); track item.id) {
            <tr [class.row-late]="item.isLate" [class.row-risk]="item.isAtRisk">
              <td>
                @if (item.isLate) { <span class="badge late">LATE</span> }
                @else if (item.isAtRisk) { <span class="badge risk">AT RISK</span> }
                @else if (item.status === 'Delivered') { <span class="badge done">DONE</span> }
                @else { <span class="badge ok">ON TRACK</span> }
              </td>

              <td>
                <strong>{{ item.trackingCode }}</strong><br />
                <small>{{ item.destination }}</small>
              </td>

              <td>{{ item.promisedAtUtc | date:'shortTime' }}</td>

              <td>
                <span class="status-tag">{{ item.status }}</span>
                @if (item.driverUnavailableWarning) {
                  <div class="warning-text">⚠ Driver unavailable — reassign!</div>
                }
              </td>

              <td>
                <div>{{ item.assignedDriverName || '— Unassigned —' }}</div>
                @if (item.history.length > 1) {
                  <details class="history-details">
                    <summary>History ({{ item.history.length }})</summary>
                    <ul>
                      @for (h of item.history; track h.assignedAtUtc) {
                        <li>{{ h.driverName }} ({{ h.assignedAtUtc | date:'shortTime' }}) - {{ h.note }}</li>
                      }
                    </ul>
                  </details>
                }
              </td>

              <td>
                @if (canReassign(item)) {
                  <select [ngModel]="item.assignedDriverId || ''" (ngModelChange)="assignDriver(item, $event)">
                    <option value="" disabled>Select driver...</option>
                    @for (drv of availableDrivers(); track drv.id) {
                      <option [value]="drv.id">{{ drv.name }}</option>
                    }
                  </select>
                } @else {
                  <span class="locked-hint" title="Customer notified; driver locked">🔒 Locked ({{ item.status }})</span>
                }

                @if (item.status === 'Assigned') {
                  <button (click)="advanceStatus(item, 'InTransit')">Start Transit</button>
                } @else if (item.status === 'InTransit') {
                  <button (click)="advanceStatus(item, 'Delivered')">Mark Delivered</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .dispatch-container { font-family: system-ui, sans-serif; max-width: 1100px; margin: 1.5rem auto; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .freshness-badge { font-size: 0.85rem; color: #555; }
    .alert { padding: 0.75rem; background: #e6f4ea; border-left: 4px solid #1e8e3e; margin-bottom: 1rem; }
    .alert.error { background: #fce8e6; border-color: #d93025; color: #a50e0e; }
    .driver-strip { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: center; }
    .driver-pill { background: #f1f3f4; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem; }
    .driver-pill.unavailable { background: #fce8e6; color: #a50e0e; }
    .dispatch-table { width: 100%; border-collapse: collapse; }
    .dispatch-table th, .dispatch-table td { padding: 0.75rem; border-bottom: 1px solid #ddd; text-align: left; }
    .row-late { background-color: #fff5f5; }
    .row-risk { background-color: #fffbeb; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .badge.late { background: #d93025; color: #fff; }
    .badge.risk { background: #f9ab00; color: #000; }
    .badge.ok { background: #e6f4ea; color: #137333; }
    .warning-text { color: #c5221f; font-size: 0.8rem; font-weight: 600; margin-top: 0.25rem; }
    .locked-hint { font-size: 0.8rem; color: #666; margin-right: 0.5rem; }
  `]
})
export class DispatchBoardComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private readonly apiUrl = 'https://localhost:44371/api';
  private pollSub?: Subscription;

  deliveries = signal<Delivery[]>([]);
  drivers = signal<Driver[]>([]);
  lastUpdated = signal<Date>(new Date());
  feedbackBanner = signal<{ message: string; isError: boolean } | null>(null);

  availableDrivers = computed(() =>
    this.drivers().filter(d => d.availability === 'Available')
  );

  ngOnInit(): void {
    // Poll every 10s immediately, skipping ticks when tab is backgrounded
  
    this.pollSub = timer(0, 10000)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        switchMap(() => this.http.get<any>(`${this.apiUrl}/dispatch`))
      )
      .subscribe({
        next: (res) => {
          debugger;
          console.log('Dispatch data refreshed:', res);
          this.deliveries.set(res.deliveries);
          this.drivers.set(res.drivers);
          this.lastUpdated.set(new Date());
        },
        error: () => this.showFeedback('Lost connection to dispatch server. Retrying...', true)
      });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  canReassign(item: Delivery): boolean {
    return item.status === 'Pending' || item.status === 'Assigned';
  }

  assignDriver(delivery: Delivery, driverId: string): void {
    if (!driverId) return;
    this.http.post(`${this.apiUrl}/deliveries/${delivery.id}/assign`, {
      driverId,
      expectedVersion: delivery.version,
      note: delivery.assignedDriverId ? 'Reassigned at dispatch desk' : 'Initial assignment'
    }).subscribe({
      next: () => {
        this.showFeedback(`Assigned ${delivery.trackingCode} successfully.`, false);
        this.refreshNow();
      },
      error: (err) => {
        this.showFeedback(err.error?.error || 'Assignment failed.', true);
        this.refreshNow(); // Re-sync stale state on 409 Conflict
      }
    });
  }

  advanceStatus(delivery: Delivery, newStatus: 'InTransit' | 'Delivered'): void {
    this.http.post(`${this.apiUrl}/deliveries/${delivery.id}/status`, {
      newStatus,
      expectedVersion: delivery.version
    }).subscribe({
      next: () => {
        this.showFeedback(`${delivery.trackingCode} moved to ${newStatus}.`, false);
        this.refreshNow();
      },
      error: (err) => this.showFeedback(err.error?.error || 'Status update failed.', true)
    });
  }

  toggleDriverSick(driver: Driver): void {
    const next = driver.availability === 'Available' ? 'Unavailable' : 'Available';
    this.http.patch(`${this.apiUrl}/drivers/${driver.id}/availability`, { availability: next })
      .subscribe(() => this.refreshNow());
  }

  refreshNow(): void {
    this.http.get<any>(`${this.apiUrl}/dispatch`).subscribe(res => {
      this.deliveries.set(res.deliveries);
      this.drivers.set(res.drivers);
      this.lastUpdated.set(new Date());
    });
  }

  private showFeedback(message: string, isError: boolean): void {
    this.feedbackBanner.set({ message, isError });
    setTimeout(() => this.feedbackBanner.set(null), 5000);
  }
}
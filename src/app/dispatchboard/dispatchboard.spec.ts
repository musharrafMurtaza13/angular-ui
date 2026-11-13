import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dispatchboard } from './dispatchboard';

describe('Dispatchboard', () => {
  let component: Dispatchboard;
  let fixture: ComponentFixture<Dispatchboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dispatchboard],
    }).compileComponents();

    fixture = TestBed.createComponent(Dispatchboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

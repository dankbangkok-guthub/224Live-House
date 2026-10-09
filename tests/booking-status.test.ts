import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingMessage } from '../src/booking-status';
test('return screen confirms only server-confirmed booking state',()=>{
  assert.equal(bookingMessage('confirmed').title,'Booking confirmed');
  for(const status of ['pending_payment','holding','manual_review','hold_expired','paid','success',''])
    assert.notEqual(bookingMessage(status).title,'Booking confirmed');
  assert.equal(bookingMessage('pending_payment').poll,true);
  assert.equal(bookingMessage('manual_review').poll,false);
  assert.match(bookingMessage('manual_review').detail,/Do not make another payment/);
});

export function bookingMessage(status:string):{title:string;detail:string;poll:boolean}{
  switch(status){
    case 'holding':case 'pending_payment':return {title:'Payment pending',detail:'Your booking is not confirmed. Resume the existing payment link while its hold is valid.',poll:true};
    case 'confirmed':return {title:'Booking confirmed',detail:'Payment has been verified by the server. Your event time is reserved.',poll:false};
    case 'in_progress':return {title:'Event in progress',detail:'Your confirmed event is underway.',poll:false};
    case 'completed':return {title:'Event completed',detail:'Your booking and payment history are shown below.',poll:false};
    case 'manual_review':return {title:'Venue review required',detail:'The team needs to review this booking or payment. Do not make another payment while the review is pending.',poll:false};
    case 'hold_expired':return {title:'Booking hold expired',detail:'Your time is no longer reserved. Check availability again before creating a new booking.',poll:false};
    case 'payment_failed':return {title:'Payment unsuccessful',detail:'The booking is not confirmed. Check its current status before starting a new booking.',poll:false};
    case 'cancelled':return {title:'Booking cancelled',detail:'See the payment records for the current refund status.',poll:false};
    case 'refund_pending':case 'partially_refunded':case 'refunded':return {title:'Refund status updated',detail:'See the payment records below. A refund update does not create a new reservation.',poll:false};
    default:return {title:'Checking booking status',detail:'Confirmation is pending. A payment redirect alone cannot confirm a booking.',poll:false};
  }
}

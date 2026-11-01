-- People can delete their own notifications (nobody else's).
create policy "recipient deletes" on public.ss_notifications for delete to authenticated
  using (recipient_id = public.ss_my_member_id(company_id));

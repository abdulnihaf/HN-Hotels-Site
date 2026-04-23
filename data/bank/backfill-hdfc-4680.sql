-- Auto-generated from HDFC account statement, 2026-04-23T19:39:53.838314
-- 408 transactions — INSERT OR IGNORE is idempotent against
-- money_events(source, source_ref) and
-- money_events(source, instrument, direction, amount_paise, txn_at).
--
-- NOTE: no BEGIN/COMMIT — D1 rejects explicit transactions in --file
-- execution. Wrangler wraps the file in its own transaction internally.

INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670051', 'credit', 10000000, 10000000, 'clearing', 'HN HOTELS PRIVATE LIMITED', NULL, 'CL1902631048HN HOTELS PRIVATE LIMITED', '2026-02-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000001', 'debit', 9500000, 500000, 'cheque', 'RK S-B NAVEEN KUMAR', NULL, 'CHQ PAID-CTS S6-RK S-B NAVEEN KUMAR', '2026-02-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000604592834419', 'credit', 100, 500100, 'imps', 'API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', NULL, 'IMPS-604592834419-API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', '2026-02-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604689734963', 'credit', 1128294, 1628394, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604689734963-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604690799747', 'credit', 601414, 2229808, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604690799747-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604792539285', 'credit', 744203, 2974011, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604792539285-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604793982866', 'credit', 381012, 3355023, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604793982866-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604895966676', 'credit', 526901, 3881924, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604895966676-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604897353889', 'credit', 305405, 4187329, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604897353889-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604999394341', 'credit', 557303, 4744632, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604999394341-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000604900935905', 'credit', 288126, 5032758, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-604900935905-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605003016345', 'credit', 558470, 5591228, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605003016345-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605004418007', 'credit', 239960, 5831188, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605004418007-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605106511192', 'credit', 707313, 6538501, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605106511192-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605107870091', 'credit', 282925, 6821426, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605107870091-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605209883549', 'credit', 949633, 7771059, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605209883549-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605211230376', 'credit', 383403, 8154462, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605211230376-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605313344826', 'credit', 1473391, 9627853, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605313344826-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605314427414', 'credit', 594684, 10222537, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605314427414-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605416253616', 'credit', 1440613, 11663150, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605416253616-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-23T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605417723105', 'credit', 576245, 12239395, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605417723105-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-23T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605519717823', 'credit', 1068932, 13308327, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605519717823-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605521118906', 'credit', 428756, 13737083, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605521118906-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605623126490', 'credit', 915384, 14652467, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605623126490-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000002', 'debit', 5000000, 9652467, 'cheque', 'RK S-FREEZE WELL ENGINEE', NULL, 'CHQ PAID-CTS S3-RK S-FREEZE WELL ENGINEE', '2026-02-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000003', 'debit', 8000000, 1652467, 'cheque', 'RK S-B NAVEEN KUMAR', NULL, 'CHQ PAID-CTS S6-RK S-B NAVEEN KUMAR', '2026-02-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605624606130', 'credit', 366152, 2018619, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605624606130-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605726661456', 'credit', 1696698, 3715317, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605726661456-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605728056442', 'credit', 719523, 4434840, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605728056442-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605830085175', 'credit', 1821395, 6256235, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605830085175-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605831610476', 'credit', 759338, 7015573, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605831610476-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000605933812166', 'credit', 2304337, 9319910, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-605933812166-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-02-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000605935600337', 'credit', 100, 9320010, 'imps', 'BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', NULL, 'IMPS-605935600337-BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', '2026-02-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60614256630', 'credit', 70300, 9390310, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60614256630', '2026-03-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001495965274', 'credit', 4991150, 14381460, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SMDBPCAIY632T1', 'FT- SMDBPCAIY632T1 - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000007575', 'debit', 1000000, 13381460, 'atm', 'BANGALORE-URB', 'E1AWBG11', 'ATW-514834XXXXXX7103-E1AWBG11-BANGALORE-URB', '2026-03-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000007576', 'debit', 2000000, 11381460, 'atm', 'BANGALORE-URB', 'E1AWBG11', 'ATW-514834XXXXXX7103-E1AWBG11-BANGALORE-URB', '2026-03-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000007577', 'debit', 2000000, 9381460, 'atm', 'BANGALORE-URB', 'E1AWBG11', 'ATW-514834XXXXXX7103-E1AWBG11-BANGALORE-URB', '2026-03-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60624324989', 'credit', 789400, 10170860, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60624324989', '2026-03-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000004', 'debit', 9000000, 1170860, 'cheque', 'RK S-AJIM MOHAMMAD', NULL, 'CHQ PAID-CTS S3-RK S-AJIM MOHAMMAD', '2026-03-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606214012153', 'debit', 1000000, 170860, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606348032122', 'credit', 4991150, 5162010, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606348032122-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606312022185', 'debit', 1000000, 4162010, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606312022186', 'debit', 1000000, 3162010, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606312022187', 'debit', 1000000, 2162010, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60643346009', 'credit', 572900, 2734910, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60643346009', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606451141058', 'credit', 4991150, 7726060, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606451141058-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606412018304', 'debit', 1000000, 6726060, 'atm', 'BANGALORE', 'RH182701', 'NWD-514834XXXXXX7103-RH182701-BANGALORE', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606412018305', 'debit', 1000000, 5726060, 'atm', 'BANGALORE', 'RH182701', 'NWD-514834XXXXXX7103-RH182701-BANGALORE', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606412018306', 'debit', 1000000, 4726060, 'atm', 'BANGALORE', 'RH182701', 'NWD-514834XXXXXX7103-RH182701-BANGALORE', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000007956', 'debit', 2000000, 2726060, 'atm', 'BANGALORE-URB', 'E1AWBG11', 'ATW-514834XXXXXX7103-E1AWBG11-BANGALORE-URB', '2026-03-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60654188363', 'credit', 352800, 3078860, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60654188363', '2026-03-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606554662326', 'credit', 3995270, 7074130, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606554662326-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000209240450656', 'credit', 214800, 7288930, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-209240450656-AWSPG2026030600010', '2026-03-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606555283297', 'credit', 995833, 8284763, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606555283297-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000005', 'debit', 7000000, 1284763, 'cheque', 'RK S-B NAVEEN KUMAR', NULL, 'CHQ PAID-CTS S6-RK S-B NAVEEN KUMAR', '2026-03-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60663944302', 'credit', 151600, 1436363, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60663944302', '2026-03-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000356373770666', 'credit', 800500, 2236863, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-356373770666-AWSPG2026030700010', '2026-03-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606658176143', 'credit', 2491275, 4728138, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606658176143-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000606609022322', 'debit', 1000000, 3728138, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606659562931', 'credit', 1002550, 4730688, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606659562931-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60674328624', 'credit', 643400, 5374088, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60674328624', '2026-03-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000586279360676', 'credit', 1533700, 6907788, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-586279360676-AWSPG2026030800010', '2026-03-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60684091596', 'credit', 404300, 7312088, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60684091596', '2026-03-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606864682895', 'credit', 4336118, 11648206, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606864682895-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606866170128', 'credit', 655031, 12303237, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606866170128-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60694428518', 'credit', 848900, 13152137, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60694428518', '2026-03-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606968317667', 'credit', 2840032, 15992169, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606968317667-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000606969710905', 'credit', 1136011, 17128180, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-606969710905-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60704503401', 'credit', 1064000, 18192180, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60704503401', '2026-03-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607071832513', 'credit', 1998748, 20190928, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607071832513-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CDT2607039073709', 'debit', 5428, 20185500, 'atm', 'ATM CASH WITHDRAWAL', NULL, 'FEE-ATM CASH(2TXN)05/03/26-CDT2607039073709', '2026-03-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607073279753', 'credit', 799499, 20984999, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607073279753-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000607021002606', 'debit', 1000000, 19984999, 'atm', 'BANGALORE', 'ED182701', 'NWD-514834XXXXXX7103-ED182701-BANGALORE', '2026-03-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60713805737', 'credit', 1393900, 21378899, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60713805737', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607175440464', 'credit', 1625911, 23004810, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607175440464-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CDT2607039073709', 'debit', 2714, 23002096, 'atm', 'ATM CASH WITHDRAWAL', NULL, 'FEE-ATM CASH(1TXN)07/03/26-CDT2607039073709', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000006', 'debit', 5000000, 18002096, 'ft', 'SHARIFF DEPARTMENTAL STORES', NULL, 'FT -SHARIFF DEPARTMENTAL STORES DR - 50200055075789 - SHARIFF DEPARTMENTAL STORES', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000007', 'debit', 5000000, 13002096, 'cheque', 'RK S-MN BROILERS', NULL, 'CHQ PAID-CTS S6-RK S-MN BROILERS', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607176753992', 'credit', 650364, 13652460, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607176753992-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000607118395238', 'debit', 1380800, 12271660, 'card', 'HDFCBPELEC', NULL, 'POS 514834XXXXXX7103 HDFCBPELEC', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00864185539', 'debit', 775000, 11496660, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00864185539-NBZPFTKKI', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00864185539-NBZPFTKKIPSXFLMZ', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00864349002', 'debit', 5000000, 6496660, 'neft', 'AJIM MOHAMMAD-NETBANK, MUM-HDFCH00864349002-NBBX5W3LHAZR3RL9', 'UTIB0002321', 'NEFT DR-UTIB0002321-AJIM MOHAMMAD-NETBANK, MUM-HDFCH00864349002-NBBX5W3LHAZR3RL9', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000272539851', 'debit', 4400000, 2096660, 'upi', 'AFEEFA IMPEX AGENCIES', 'NBXZ0OHEXRIX7FMJ', '50200116872951-TPT-NBXZ0OHEXRIX7FMJ-AFEEFA IMPEX AGENCIES', '2026-03-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00864465883', 'debit', 1687900, 408760, 'neft', 'SREE MANJULA ENTERPRISES-NETBANK, MUM-HDFCH00864465883-NBCQXH5NK5LCNXT5', 'IBKL0001241', 'NEFT DR-IBKL0001241-SREE MANJULA ENTERPRISES-NETBANK, MUM-HDFCH00864465883-NBCQXH5NK5LCNXT5', '2026-03-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Sree Manjula Enterprises Biscuite Boxes [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60724378901', 'credit', 547400, 956160, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60724378901', '2026-03-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607278789474', 'credit', 2068578, 3024738, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607278789474-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607280125461', 'credit', 827553, 3852291, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607280125461-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00866635520', 'debit', 300000, 3552291, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00866635520-DAILY SALARY 13TH', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00866635520-DAILY SALARY 13TH', '2026-03-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60731260741', 'credit', 2438802, 5991093, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60731260741', '2026-03-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607382239430', 'credit', 1996423, 7987516, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607382239430-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00867871440', 'debit', 300000, 7687516, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00867871440-NBH9NYDFJEUDBHB7', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00867871440-NBH9NYDFJEUDBHB7', '2026-03-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000607335162645', 'debit', 500000, 7187516, 'imps', 'SRI KRISHNA ENTERPRISES-FDRL-XXXXXXXXXX1019-IMPS TRANSACTION', NULL, 'IMPS-607335162645-SRI KRISHNA ENTERPRISES-FDRL-XXXXXXXXXX1019-IMPS TRANSACTION', '2026-03-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Sri Krishna Enterprises Fire wood Vendor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000343196', 'debit', 1850400, 5337116, 'card_subscription', 'CLAUDE.AI SUBSCRIPTION', NULL, 'ME DC SI 514834XXXXXX7103 CLAUDE.AI SUBSCRIPTION', '2026-03-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00868061789', 'debit', 600000, 4737116, 'neft', 'MD AKTAR-NETBANK, MUM-HDFCH00868061789-NBEB5ZIEKECCSGDP', 'AIRP0000001', 'NEFT DR-AIRP0000001-MD AKTAR-NETBANK, MUM-HDFCH00868061789-NBEB5ZIEKECCSGDP', '2026-03-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60744486529', 'credit', 1275100, 6012216, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60744486529', '2026-03-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000607435265483', 'debit', 700000, 5312216, 'imps', 'B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-IMPS TRANSACTION', NULL, 'IMPS-607435265483-B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-IMPS TRANSACTION', '2026-03-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00868316671', 'debit', 1200000, 4112216, 'neft', 'YASHWANT JODHA-NETBANK, MUM-HDFCH00868316671-NBRFDNXUQ00PREOS', 'CNRB0000350', 'NEFT DR-CNRB0000350-YASHWANT  JODHA-NETBANK, MUM-HDFCH00868316671-NBRFDNXUQ00PREOS', '2026-03-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Yashwant Jodha [unknown]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00868345380', 'debit', 300000, 3812216, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00868345380-NBTRNJDEMU3CDDMY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00868345380-NBTRNJDEMU3CDDMY', '2026-03-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60750935779', 'credit', 2298800, 6111016, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60750935779', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001524533177', 'credit', 4991150, 11102166, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SRKEFYLLUXEHQC', 'FT- SRKEFYLLUXEHQC - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CDT2607039073709', 'debit', 2714, 11099452, 'atm', 'ATM CASH WITHDRAWAL', NULL, 'FEE-ATM CASH(1TXN)12/03/26-CDT2607039073709', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00869499632', 'debit', 300000, 10799452, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00869499632-NBMJ7OHNQREPUPTU', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00869499632-NBMJ7OHNQREPUPTU', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000323158390756', 'credit', 1388600, 12188052, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-323158390756-AWSPG2026031600010', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000990993580', 'debit', 459900, 11728152, 'upi', 'AHMED SHAHEEN', 'EXP REIMBURSEMENT', '50100787755360-TPT-EXP REIMBURSEMENT-AHMED SHAHEEN', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Ahmed Shaheen [unknown]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00870800849', 'debit', 500000, 11228152, 'neft', 'ARBEEN TAJ-NETBANK, MUM-HDFCH00870800849-EMPLOYEE BONUS', 'SBIN0014933', 'NEFT DR-SBIN0014933-ARBEEN TAJ-NETBANK, MUM-HDFCH00870800849-EMPLOYEE BONUS', '2026-03-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60764375719', 'credit', 261300, 11489452, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60764375719', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607692508462', 'credit', 4058882, 15548334, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607692508462-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00871312672', 'debit', 500000, 15048334, 'neft', 'ARBEEN TAJ-NETBANK, MUM-HDFCH00871312672-EMPLOYEE BONUS', 'SBIN0014933', 'NEFT DR-SBIN0014933-ARBEEN TAJ-NETBANK, MUM-HDFCH00871312672-EMPLOYEE BONUS', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00871934307', 'debit', 300000, 14748334, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00871934307-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00871934307-DAILY SALARY', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607693904402', 'credit', 932267, 15680601, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607693904402-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000176732', 'debit', 196700, 15483901, 'card', '176732 17MAR26 18:35:39 BANGALORE AMAZON PAY INDIA PRIVA', NULL, 'POS 514834XXXXXX7103 176732 17MAR26 18:35:39 BANGALORE AMAZON PAY INDIA PRIVA', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000377246', 'debit', 133000, 15350901, 'card', '377246 17MAR26 18:38:41 BANGALORE BUNDL TECHNOLOGIES PRI', NULL, 'POS 514834XXXXXX7103 377246 17MAR26 18:38:41 BANGALORE BUNDL TECHNOLOGIES PRI', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000127131343', 'debit', 5000000, 10350901, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'SHARIFF PAYMENT', '50200055075789-TPT-SHARIFF PAYMENT-SHARIFF DEPARTMENTAL STORES', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00872947377', 'debit', 2500000, 7850901, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00872947377-HALEEM SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00872947377-HALEEM SALARY', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00873096289', 'debit', 914000, 6936901, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00873096289-TILL 16TH DATE PAI', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00873096289-TILL 16TH DATE PAI', '2026-03-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00873101601', 'debit', 1890000, 5046901, 'neft', 'MOHAMMED IQRAR PASHA-NETBANK, MUM-HDFCH00873101601-180 PKTS RECEIVED', 'IOBA0003601', 'NEFT DR-IOBA0003601-MOHAMMED IQRAR PASHA-NETBANK, MUM-HDFCH00873101601-180 PKTS RECEIVED', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60774488572', 'credit', 2545000, 7591901, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60774488572', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607796021112', 'credit', 2411732, 10003633, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607796021112-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607797511463', 'credit', 976532, 10980165, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607797511463-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00874911569', 'debit', 300000, 10680165, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00874911569-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00874911569-DAILY SALARY', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875236694', 'debit', 5000000, 5680165, 'neft', 'M N BROILERS PROP SYED AHMEDULLA-NETBANK, MUM-HDFCH00875236694-NB3DSJQBZ2DIKZO8', 'JAKA0BNGLOR', 'NEFT DR-JAKA0BNGLOR-M N BROILERS PROP SYED AHMEDULLA-NETBANK, MUM-HDFCH00875236694-NB3DSJQBZ2DIKZO8', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875242966', 'debit', 512000, 5168165, 'neft', 'MUDASSIR PASHA-NETBANK, MUM-HDFCH00875242966-4 BAGS', 'KKBK0008061', 'NEFT DR-KKBK0008061-MUDASSIR  PASHA-NETBANK, MUM-HDFCH00875242966-4 BAGS', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mudassir Pasha Charcoal Supplier [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875245841', 'debit', 775000, 4393165, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00875245841-NBMBX5RN0', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00875245841-NBMBX5RN0E4OGUZN', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875248257', 'debit', 2500000, 1893165, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00875248257-PAID OUT', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00875248257-PAID OUT', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875287951', 'debit', 1000000, 893165, 'neft', 'ARBEEN TAJ-NETBANK, MUM-HDFCH00875287951-PETTY CASH', 'SBIN0014933', 'NEFT DR-SBIN0014933-ARBEEN TAJ-NETBANK, MUM-HDFCH00875287951-PETTY CASH', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000541109', 'debit', 106929, 786236, 'card', '541109 18MAR26 23:22:04 GOTHENBURG, S VPN* BS5PUSTQKR', NULL, 'POS 514834XXXXXX7103 541109 18MAR26 23:22:04 GOTHENBURG, S VPN* BS5PUSTQKR', '2026-03-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60784144530', 'credit', 1366900, 2153136, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60784144530', '2026-03-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875651057', 'debit', 400000, 1753136, 'neft', 'MD AKTAR-NETBANK, MUM-HDFCH00875651057-SALARY ADVANCE', 'AIRP0000001', 'NEFT DR-AIRP0000001-MD AKTAR-NETBANK, MUM-HDFCH00875651057-SALARY ADVANCE', '2026-03-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: MD Aktar Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00875669169', 'debit', 1000000, 753136, 'neft', 'HARI PRASAD B-NETBANK, MUM-HDFCH00875669169-COAL BHATTI ADVANC', 'CBIN0281200', 'NEFT DR-CBIN0281200-HARI PRASAD B-NETBANK, MUM-HDFCH00875669169-COAL BHATTI ADVANC', '2026-03-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Coal Bhatti [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00876570385', 'debit', 300000, 453136, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00876570385-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00876570385-DAILY SALARY', '2026-03-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60794322237', 'credit', 3298800, 3751936, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60794322237', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2607974540558', 'debit', 76422, 3675514, 'charges', 'INTL POS MARKUP FEE', NULL, 'DC INTL POS TXN MARKUP+ST 140326-EPR2607974540558', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607902965575', 'credit', 3675371, 7350885, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607902965575-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00877889854', 'debit', 700000, 6650885, 'neft', 'MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00877889854-SALARY ADVANCE', 'JAKA0FRAZER', 'NEFT DR-JAKA0FRAZER-MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00877889854-SALARY ADVANCE', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mohammed Ismail Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000607904451746', 'credit', 1315778, 7966663, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-607904451746-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00878234662', 'debit', 500000, 7466663, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00878234662-EDI BONUS NIHAF', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00878234662-EDI BONUS NIHAF', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00878961989', 'debit', 300000, 7166663, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00878961989-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00878961989-DAILY SALARY', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000607937550803', 'debit', 500000, 6666663, 'imps', 'K M HANEEF-FDRL-XXXXXXXXXX4486-WITHDRAWAL', NULL, 'IMPS-607937550803-K M HANEEF-FDRL-XXXXXXXXXX4486-WITHDRAWAL', '2026-03-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60804372350', 'credit', 2529000, 9195663, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60804372350', '2026-03-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000843784', 'debit', 200000, 8995663, 'card', '843784 21MAR26 16:21:00 MUMBAI GOOGLESERVIS', NULL, 'POS 514834XXXXXX7103 843784 21MAR26 16:21:00 MUMBAI GOOGLESERVIS', '2026-03-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60814405517', 'credit', 2979203, 11974866, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60814405517', '2026-03-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000413994940816', 'credit', 248500, 12223366, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-413994940816-AWSPG2026032200010', '2026-03-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2608179502808', 'debit', 1262, 12222104, 'charges', 'INTL POS DCC FEE', NULL, 'DC INTL POS TXN DCC+ST 180326-EPR2608179502808', '2026-03-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00880348358', 'debit', 1353000, 10869104, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00880348358-WATER BOTTLES', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00880348358-WATER BOTTLES', '2026-03-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Nazeer Nadeem Bisleri Water Vendor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60824203412', 'credit', 1150400, 12019504, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60824203412', '2026-03-23T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608212290023', 'credit', 3626630, 15646134, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608212290023-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-23T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608213745567', 'credit', 1364517, 17010651, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608213745567-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-23T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60834408263', 'credit', 372500, 17383151, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60834408263', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608315773106', 'credit', 666453, 18049604, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608315773106-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', 'AXISCN1291392404', 'credit', 278053, 18327657, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1291392404', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608317151156', 'credit', 195553, 18523210, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608317151156-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000153837', 'debit', 200, 18523010, 'card', '153837 24MAR26 17:54:15 MUMBAI GOOGLESERVIS', NULL, 'POS 514834XXXXXX7103 153837 24MAR26 17:54:15 MUMBAI GOOGLESERVIS', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00884704925', 'debit', 5000000, 13523010, 'neft', 'M N BROILERS PROP SYED AHMEDULLA-NETBANK, MUM-HDFCH00884704925-MN CHICKEN PAYMEN', 'JAKA0BNGLOR', 'NEFT DR-JAKA0BNGLOR-M N BROILERS PROP SYED AHMEDULLA-NETBANK, MUM-HDFCH00884704925-MN CHICKEN PAYMENT', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00884716495', 'debit', 5000000, 8523010, 'neft', 'HKGN MUTTON STALL-NETBANK, MUM-HDFCH00884716495-BILL 4750 PENDING', 'ICIC0006252', 'NEFT DR-ICIC0006252-HKGN MUTTON STALL-NETBANK, MUM-HDFCH00884716495-BILL 4750 PENDING', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: HKGN Mutton Noor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000352040216', 'debit', 7000000, 1523010, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'SHARIFF STORE', '50200055075789-TPT-SHARIFF STORE-SHARIFF DEPARTMENTAL STORES', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00884757939', 'debit', 256000, 1267010, 'neft', 'MUDASSIR PASHA-NETBANK, MUM-HDFCH00884757939-CHARCOAL', 'KKBK0008061', 'NEFT DR-KKBK0008061-MUDASSIR  PASHA-NETBANK, MUM-HDFCH00884757939-CHARCOAL', '2026-03-24T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mudassir Pasha Charcoal Supplier [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60844097978', 'credit', 500203, 1767213, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60844097978', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608419175628', 'credit', 625309, 2392522, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608419175628-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000459219', 'debit', 300, 2392222, 'card', '459219 25MAR26 13:46:09 HYDERABAD FACEBOOK INDIA ONLINE', NULL, 'POS 514834XXXXXX7103 459219 25MAR26 13:46:09 HYDERABAD FACEBOOK INDIA ONLINE', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608420630814', 'credit', 396567, 2788789, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608420630814-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000FTIMPS177656', 'debit', 800000, 1988789, 'ft', 'WITHDRAWAL-K M HANEEF-FTIMPS177656', '59109900556600', 'FT-59109900556600-WITHDRAWAL-K M HANEEF-FTIMPS177656', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00887491512', 'debit', 475000, 1513789, 'neft', 'HKGN MUTTON STALL-NETBANK, MUM-HDFCH00887491512-BALANCE PAID', 'ICIC0006252', 'NEFT DR-ICIC0006252-HKGN MUTTON STALL-NETBANK, MUM-HDFCH00887491512-BALANCE PAID', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: HKGN Mutton Noor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000177789050846', 'credit', 1021902, 2535691, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-177789050846-AWSPG2026032500010', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00887599633', 'debit', 2500000, 35691, 'neft', 'ASIF-NETBANK, MUM-HDFCH00887599633-ASHIF SETTLEMENT', 'JAKA0NEHAAL', 'NEFT DR-JAKA0NEHAAL-ASIF-NETBANK, MUM-HDFCH00887599633-ASHIF SETTLEMENT', '2026-03-25T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60854355842', 'credit', 372300, 407991, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60854355842', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000239504860856', 'credit', 251000, 658991, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-239504860856-AWSPG2026032600010', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000248368530856', 'credit', 300000, 958991, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-248368530856-AWSPG2026032604350', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00887698760', 'debit', 900000, 58991, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00887698760-NBZMWEVJIHJCI3CQ', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00887698760-NBZMWEVJIHJCI3CQ', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001540638881', 'credit', 702010, 761001, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SVHYWOKULKGV7U', 'FT- SVHYWOKULKGV7U - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001541386975', 'credit', 336998, 1097999, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SVQAWBOLRRH25B', 'FT- SVQAWBOLRRH25B - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-26T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60864226586', 'credit', 527854, 1625853, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60864226586', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001542494302', 'credit', 800165, 2426018, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SW6XSPL5FEY1UP', 'FT- SW6XSPL5FEY1UP - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000198957', 'debit', 200, 2425818, 'card', '198957 27MAR26 10:20:11 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 198957 27MAR26 10:20:11 MUMBAI GOOGLECLOUD', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000408179089', 'debit', 312100, 2113718, 'billpay', 'BESCOM (electricity)', 'HGAKP16DDF0983421631', 'HGAKP16DDF0983421631-BANGALOREEL-BILLPAY-50200026202917', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000408179843', 'debit', 129100, 1984618, 'billpay', 'BESCOM (electricity)', 'HGAKP0C22F0983488961', 'HGAKP0C22F0983488961-BANGALOREEL-BILLPAY-50200026202917', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00890977693', 'debit', 1500000, 484618, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00890977693-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00890977693-PETTY CASH', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608627350652', 'credit', 396177, 880795, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608627350652-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0178', 'credit', 300, 881095, 'card_refund', 'FACEBOOK INDIA', NULL, 'CRV POS 514834******7103 FACEBOOK INDIA', '2026-03-27T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60874550499', 'credit', 941900, 1822995, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60874550499', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608729356905', 'credit', 1045470, 2868465, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608729356905-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000742237', 'debit', 17000, 2851465, 'card', '742237 28MAR26 14:33:10 MUMBAI JIOHOTSTAR', NULL, 'POS 514834XXXXXX7103 742237 28MAR26 14:33:10 MUMBAI JIOHOTSTAR', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608730593873', 'credit', 505037, 3356502, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608730593873-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000408277853', 'debit', 799400, 2557102, 'billpay', 'BESCOM (electricity)', 'HGAKP00CF40994208010', 'HGAKP00CF40994208010-BANGALOREEL-BILLPAY-50200026202917', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00893445847', 'debit', 500000, 2057102, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00893445847-SALARY ADVANCE', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00893445847-SALARY ADVANCE', '2026-03-28T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60884805123', 'credit', 1274386, 3331488, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60884805123', '2026-03-29T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001545307365', 'credit', 1112720, 4444208, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SWTB6OWCIPG2N9', 'FT- SWTB6OWCIPG2N9 - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-29T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001545510269', 'credit', 513417, 4957625, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SX1MK2NCBTPLXG', 'FT- SX1MK2NCBTPLXG - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-29T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00893816851', 'debit', 900000, 4057625, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00893816851-SALARY UPTO 29 MAR', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00893816851-SALARY UPTO 29 MAR', '2026-03-29T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00893820878', 'debit', 1000000, 3057625, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00893820878-PAID OUT', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00893820878-PAID OUT', '2026-03-29T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60894575952', 'credit', 990400, 4048025, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60894575952', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001545837814', 'credit', 962737, 5010762, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SXI7GO4RLEPJUL', 'FT- SXI7GO4RLEPJUL - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000583196', 'debit', 49600, 4961162, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 583196 30MAR26 12:34:45 GURGAON PAY*SWIGGY INSTAMART', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000608936929802', 'credit', 494906, 5456068, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-608936929802-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00897956249', 'debit', 1500000, 3956068, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00897956249-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00897956249-PETTY CASH', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00897961553', 'debit', 300000, 3656068, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00897961553-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00897961553-DAILY SALARY', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000472890519', 'debit', 2500000, 1156068, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'SHARIFF STORE', '50200055075789-TPT-SHARIFF STORE-SHARIFF DEPARTMENTAL STORES', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00898020344', 'debit', 768000, 388068, 'neft', 'MUDASSIR PASHA-NETBANK, MUM-HDFCH00898020344-COAL PURCHASE', 'KKBK0008061', 'NEFT DR-KKBK0008061-MUDASSIR  PASHA-NETBANK, MUM-HDFCH00898020344-COAL PURCHASE', '2026-03-30T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mudassir Pasha Charcoal Supplier [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000359235', 'debit', 48000, 340068, 'card', '359235 31MAR26 02:50:16 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 359235 31MAR26 02:50:16 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000841368', 'debit', 11700, 328368, 'card', '841368 31MAR26 03:42:21 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 841368 31MAR26 03:42:21 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60904565439', 'credit', 242000, 570368, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60904565439', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609039012125', 'credit', 881249, 1451617, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609039012125-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000315292150906', 'credit', 344750, 1796367, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-315292150906-AWSPG2026033100010', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000054732', 'debit', 200, 1796167, 'card', '054732 31MAR26 15:21:07 MUMBAI GOOGLEWORKSP', NULL, 'POS 514834XXXXXX7103 054732 31MAR26 15:21:07 MUMBAI GOOGLEWORKSP', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001550496432', 'credit', 431563, 2227730, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SXOSIMAWGBY5UL', 'FT- SXOSIMAWGBY5UL - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609042089272', 'debit', 500000, 1727730, 'imps', 'K M HANEEF-FDRL-XXXXXXXXXX4486-WITHDRAWAL', NULL, 'IMPS-609042089272-K M HANEEF-FDRL-XXXXXXXXXX4486-WITHDRAWAL', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000696588286857', 'credit', 1310000, 3037730, 'upi', 'NAVEENKUMAR.CA0@AXL', 'NAVEENKUMAR.CA0@AXL', 'UPI-B NAVEEN KUMAR-NAVEENKUMAR.CA0@AXL-FDRL0001104-696588286857-PAYMENT FROM PHONE', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000132252583', 'debit', 2250000, 787730, 'upi', 'AFEEFA IMPEX AGENCIES', 'TEA POWDER 50KG', '50200116872951-TPT-TEA POWDER 50KG-AFEEFA IMPEX AGENCIES', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00901641617', 'debit', 500000, 287730, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00901641617-NBJUEIBJEAVMMXOD', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00901641617-NBJUEIBJEAVMMXOD', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609043274251', 'credit', 374834, 662564, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609043274251-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609043419165', 'credit', 183374, 845938, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609043419165-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00901761561', 'debit', 800000, 45938, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00901761561-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00901761561-PETTY CASH', '2026-03-31T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000753746', 'debit', 12500, 33438, 'card', '753746 01APR26 02:48:52 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 753746 01APR26 02:48:52 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60915298202', 'credit', 161981, 195419, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60915298202', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001551401920', 'credit', 388597, 584016, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SY5C5BCCGLP54W', 'FT- SY5C5BCCGLP54W - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000FTIMPS432561', 'debit', 500000, 84016, 'ft', 'SHAHEEN EXP-AHMED SHAHEEN-FTIMPS432561', '50100787755360', 'FT-50100787755360-SHAHEEN EXP-AHMED SHAHEEN-FTIMPS432561', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Ahmed Shaheen [unknown]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000743669', 'debit', 48000, 36016, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 743669 01APR26 16:37:40 BANGALORE SWIGGY', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001552070306', 'credit', 293701, 329717, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SYDN3AWO63HEEZ', 'FT- SYDN3AWO63HEEZ - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000609196152534', 'credit', 349917, 679634, 'imps', 'PAYTM', NULL, 'IMPS-609196152534-PAYTM PAYMENTS SERVICES LIMITED PA ESCROW AC-YESB-XXXXXXXXXXX0058-AWSPG2026040100010ZPRZUL15432995875', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00903436673', 'debit', 500000, 179634, 'neft', 'ROYAL POLYMERS-NETBANK, MUM-HDFCH00903436673-FOR MATS', 'IDIB000B075', 'NEFT DR-IDIB000B075-ROYAL POLYMERS-NETBANK, MUM-HDFCH00903436673-FOR MATS', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Royal Polymers Mats [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000200561', 'debit', 65400, 114234, 'card', '200561 01APR26 22:03:24 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 200561 01APR26 22:03:24 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-01T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000400437', 'debit', 13900, 100334, 'card', '400437 02APR26 00:06:19 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 400437 02APR26 00:06:19 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000605487', 'debit', 12500, 87834, 'card', '605487 02APR26 03:02:08 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 605487 02APR26 03:02:08 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60924537167', 'credit', 184400, 272234, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60924537167', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001553354024', 'credit', 811142, 1083376, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SYTKLZEZMNIMMY', 'FT- SYTKLZEZMNIMMY - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00905207961', 'debit', 1000000, 83376, 'neft', 'SK OSIMAKRAM-NETBANK, MUM-HDFCH00905207961-SALARY SETTLEMENT', 'SBIN0002014', 'NEFT DR-SBIN0002014-SK OSIMAKRAM-NETBANK, MUM-HDFCH00905207961-SALARY SETTLEMENT', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0226', 'credit', 1260000, 1343376, 'cash_deposit', 'CASH DEPOSIT', NULL, 'CASH DEPOSIT BY - SELF - FRAZER TOWN, BANG', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('eazydiner', 'hdfc_ca_4680', 'YESF360926443902', 'credit', 100, 1343476, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF360926443902', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609258568265', 'credit', 419588, 1763064, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609258568265-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0229', 'credit', 200, 1763264, 'card_refund', 'GOOGLESERVIS', NULL, 'CRV POS 514834******7103 GOOGLESERVIS', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00906646916', 'debit', 1000000, 763264, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00906646916-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00906646916-PETTY CASH', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00906962308', 'debit', 300000, 463264, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00906962308-UP TO 31ST PAID', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00906962308-UP TO 31ST PAID', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907058719', 'debit', 400000, 63264, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00907058719-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00907058719-PETTY CASH', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000865209', 'debit', 27500, 35764, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 865209 02APR26 21:26:21 GURGAON WWW SWIGGY COM', '2026-04-02T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60934523847', 'credit', 290400, 326164, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60934523847', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609360933220', 'credit', 850093, 1176257, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609360933220-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907711825', 'debit', 775000, 401257, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00907711825-INVOICED ', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00907711825-INVOICED 30TH MARC', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907889549', 'debit', 400000, 1257, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00907889549-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00907889549-PETTY CASH', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001556374542', 'credit', 492123, 493380, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZ0S8E1ENKPWFE', 'FT- SZ0S8E1ENKPWFE - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000094155', 'debit', 48000, 445380, 'card', '094155 03APR26 17:44:54 BANGALORE PHONEPE PRIV*ZEPTO MAR', NULL, 'POS 514834XXXXXX7103 094155 03APR26 17:44:54 BANGALORE PHONEPE PRIV*ZEPTO MAR', '2026-04-03T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000633939', 'debit', 11310, 434070, 'card_subscription', 'GOOGLECLOUD', NULL, 'ME DC SI 514834XXXXXX7103 GOOGLECLOUD', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000732256', 'debit', 13000, 421070, 'card', '732256 04APR26 01:13:33 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 732256 04APR26 01:13:33 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60944407566', 'credit', 631600, 1052670, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60944407566', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000643361', 'debit', 13000, 1039670, 'card', '643361 04APR26 05:45:35 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 643361 04APR26 05:45:35 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001557145051', 'credit', 939715, 1979385, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZGO8XVFOWUDR6', 'FT- SZGO8XVFOWUDR6 - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000876882', 'debit', 29200, 1950185, 'card', '876882 04APR26 11:55:03 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 876882 04APR26 11:55:03 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609465904788', 'credit', 520271, 2470456, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609465904788-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911064601', 'debit', 300000, 2170456, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911064601-UPTO 31ST MAR CLOS', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911064601-UPTO 31ST MAR CLOS', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609444428855', 'debit', 1500000, 670456, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', NULL, 'IMPS-609444428855-TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911131705', 'debit', 650000, 20456, 'neft', 'ROYAL POLYMERS-NETBANK, MUM-HDFCH00911131705-DOOR MATS', 'IDIB000B075', 'NEFT DR-IDIB000B075-ROYAL POLYMERS-NETBANK, MUM-HDFCH00911131705-DOOR MATS', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Royal Polymers Mats [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000387246', 'debit', 19300, 1156, 'card', '387246 04APR26 23:02:28 BANGALORE FLIPKART INTERNET PVT', NULL, 'POS 514834XXXXXX7103 387246 04APR26 23:02:28 BANGALORE FLIPKART INTERNET PVT', '2026-04-04T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60954627461', 'credit', 930380, 931536, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60954627461', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609568338991', 'credit', 1107158, 2038694, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609568338991-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000518986', 'debit', 21600, 2017094, 'card', '518986 05APR26 11:20:29 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 518986 05APR26 11:20:29 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911623058', 'debit', 2000000, 17094, 'neft', 'AJIM MOHAMMAD-NETBANK, MUM-HDFCH00911623058-DAILY SALARY', 'UTIB0002321', 'NEFT DR-UTIB0002321-AJIM MOHAMMAD-NETBANK, MUM-HDFCH00911623058-DAILY SALARY', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Ajim Mohammad Head Cook Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001559199739', 'credit', 571571, 588665, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZNVVVWNRAVULE', 'FT- SZNVVVWNRAVULE - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0256', 'credit', 200, 588865, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000609569778347', 'credit', 876800, 1465665, 'imps', 'PAYTM', NULL, 'IMPS-609569778347-PAYTMPAYMENTSSERVICESLTDPAYMENTAGGREGATORESCR-UTIB-XXXXXXXXXXX2533-IMPS', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001559273863', 'credit', 293578, 1759243, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZPBAOOT200HCM', 'FT- SZPBAOOT200HCM - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911739609', 'debit', 1000000, 759243, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911739609-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911739609-DAILY SALARY', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911742385', 'debit', 500000, 259243, 'neft', 'ARBEEN TAJ-NETBANK, MUM-HDFCH00911742385-SALARY ADVANCE', 'SBIN0014933', 'NEFT DR-SBIN0014933-ARBEEN TAJ-NETBANK, MUM-HDFCH00911742385-SALARY ADVANCE', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911763705', 'debit', 200000, 59243, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911763705-UPTO 4 MARCH CLOSE', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911763705-UPTO 4 MARCH CLOSE', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609520548433', 'credit', 9254400, 9313643, 'imps', 'B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-HN HOTELS PRIVATE LIMITED', NULL, 'IMPS-609520548433-B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-HN HOTELS PRIVATE LIMITED', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000244537', 'debit', 20300, 9293343, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 244537 05APR26 20:48:00 BANGALORE PAY*SWIGGY', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000250928', 'debit', 32100, 9261243, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 250928 05APR26 22:12:01 BANGALORE PAY*SWIGGY', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000133765', 'debit', 19100, 9242143, 'card', '133765 05APR26 23:36:16 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 133765 05APR26 23:36:16 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-05T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000523385', 'debit', 17600, 9224543, 'card', '523385 06APR26 00:02:53 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 523385 06APR26 00:02:53 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60964509594', 'credit', 323962, 9548505, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60964509594', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001559749943', 'credit', 791972, 10340477, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SA3U9FT2CSLZEK', 'FT- SA3U9FT2CSLZEK - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000641954', 'debit', 22100, 10318377, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 641954 06APR26 11:26:16 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670392', 'debit', 20700, 10297677, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 670392 06APR26 12:31:39 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670619', 'debit', 20400, 10277277, 'card', '670619 06APR26 12:51:37 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 670619 06APR26 12:51:37 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000718366', 'debit', 28900, 10248377, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 718366 06APR26 14:28:46 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000732056', 'debit', 200000, 10048377, 'card_subscription', 'GOOGLECLOUD', NULL, 'ME DC SI 514834XXXXXX7103 GOOGLECLOUD', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000746151', 'debit', 50600, 9997777, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 746151 06APR26 15:40:17 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609673113252', 'credit', 389822, 10387599, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609673113252-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0276', 'credit', 13000, 10400599, 'card_refund', 'ZEPTO909NPLCYBS', NULL, 'CRV POS 514834******7103 ZEPTO909NPLCYBS', '2026-04-06T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000932300', 'debit', 37500, 10363099, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 932300 07APR26 00:09:06 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60974384547', 'credit', 334600, 10697699, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60974384547', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609775436678', 'credit', 831579, 11529278, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609775436678-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000074423', 'debit', 200, 11529078, 'card', '074423 07APR26 12:31:47 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 074423 07APR26 12:31:47 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000085004', 'debit', 200, 11528878, 'card', '085004 07APR26 12:57:13 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 085004 07APR26 12:57:13 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000087981', 'debit', 200, 11528678, 'card', '087981 07APR26 13:04:45 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 087981 07APR26 13:04:45 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00917457082', 'debit', 1000000, 10528678, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00917457082-NBEQANQNUBC340ZR', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00917457082-NBEQANQNUBC340ZR', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00917724952', 'debit', 1000000, 9528678, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00917724952-SALARY ADVANCE', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00917724952-SALARY ADVANCE', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609776805325', 'credit', 416341, 9945019, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609776805325-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670721', 'debit', 75100, 9869919, 'card', '670721 07APR26 17:25:54 GURGAON BLINKIT', NULL, 'POS 514834XXXXXX7103 670721 07APR26 17:25:54 GURGAON BLINKIT', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000224093', 'debit', 17000, 9852919, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 224093 07APR26 19:03:59 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000318289', 'debit', 30100, 9822819, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 318289 07APR26 23:30:11 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000689185', 'debit', 20711, 9802108, 'card', 'ZOMATO', NULL, 'POS 514834XXXXXX7103 689185 08APR26 01:29:35 GURGAON ZOMATO ONLINE ORDER', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60984508111', 'credit', 617000, 10419108, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60984508111', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000346805', 'debit', 34400, 10384708, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 346805 08APR26 06:40:29 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609879091597', 'credit', 802546, 11187254, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609879091597-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000390831', 'debit', 25400, 11161854, 'card', '390831 08APR26 09:18:12 MUMBAI ZEPTO', NULL, 'POS 514834XXXXXX7103 390831 08APR26 09:18:12 MUMBAI ZEPTO', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609880544207', 'credit', 429008, 11590862, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609880544207-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922084836', 'debit', 600000, 10990862, 'neft', 'MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00922084836-WEEKLY SALARY', 'JAKA0FRAZER', 'NEFT DR-JAKA0FRAZER-MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00922084836-WEEKLY SALARY', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mohammed Ismail Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922608378', 'debit', 1000000, 9990862, 'neft', 'SHAIK NOOR AHMED-NETBANK, MUM-HDFCH00922608378-SALARY ADVANCE', 'IOBA0003604', 'NEFT DR-IOBA0003604-SHAIK NOOR AHMED-NETBANK, MUM-HDFCH00922608378-SALARY ADVANCE', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Noor Ahmed Employee Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000473917', 'debit', 51000, 9939862, 'card', '473917 08APR26 19:28:23 GURGAON BLINKIT', NULL, 'POS 514834XXXXXX7103 473917 08APR26 19:28:23 GURGAON BLINKIT', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922706408', 'debit', 500000, 9439862, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00922706408-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00922706408-PETTY CASH', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000638923', 'debit', 57100, 9382762, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 638923 08APR26 19:54:21 BANGALORE RSP*SWIGGY', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0300', 'credit', 19100, 9401862, 'card_refund', 'ZEPTO909NPLCYBS', NULL, 'CRV POS 514834******7103 ZEPTO909NPLCYBS', '2026-04-08T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP60994552599', 'credit', 649324, 10051186, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60994552599', '2026-04-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609982817828', 'credit', 842062, 10893248, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609982817828-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000609984165165', 'credit', 426769, 11320017, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609984165165-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0304', 'credit', 200, 11320217, 'card_refund', 'GOOGLEWORKSP', NULL, 'CRV POS 514834******7103 GOOGLEWORKSP', '2026-04-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00925133108', 'debit', 2000000, 9320217, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00925133108-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00925133108-PETTY CASH', '2026-04-09T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61005274123', 'credit', 351900, 9672117, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61005274123', '2026-04-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610086451477', 'credit', 865499, 10537616, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610086451477-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000009', 'debit', 9254400, 1283216, 'cheque', 'RK S-FREEZ WELL ENGINEER', NULL, 'CHQ PAID-CTS S5-RK S-FREEZ WELL ENGINEER', '2026-04-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610087852349', 'credit', 463922, 1747138, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610087852349-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00928036805', 'debit', 1000000, 747138, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00928036805-FOR VELU SALARY', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00928036805-FOR VELU SALARY', '2026-04-10T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61015187280', 'credit', 411462, 1158600, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61015187280', '2026-04-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610190195615', 'credit', 970743, 2129343, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610190195615-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001573524604', 'credit', 512257, 2641600, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SCAII2IZXBFWMH', 'FT- SCAII2IZXBFWMH - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610147648319', 'debit', 1900000, 741600, 'imps', 'MD KESMAT SK-PUNB-XXXXXXXXXX4120-SALARY', NULL, 'IMPS-610147648319-MD KESMAT SK-PUNB-XXXXXXXXXX4120-SALARY', '2026-04-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: MD Kesmat SK Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610147649176', 'debit', 420000, 321600, 'imps', 'NOIM UDDIN-CBIN-XXXXXX0798-SALARY', NULL, 'IMPS-610147649176-NOIM  UDDIN-CBIN-XXXXXX0798-SALARY', '2026-04-11T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Noim Uddin Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61024795165', 'credit', 529119, 850719, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61024795165', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000001573960081', 'credit', 1267404, 2118123, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SCR4ROU1KHKP3F', 'FT- SCR4ROU1KHKP3F - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000571027', 'debit', 19400, 2098723, 'card', '571027 12APR26 10:01:47 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 571027 12APR26 10:01:47 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000500269', 'debit', 139598, 1959125, 'card_subscription', 'FIGMA', NULL, 'ME DC SI 514834XXXXXX7103 FIGMA', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000252091', 'debit', 11682, 1947443, 'card', '252091 12APR26 15:42:33 MUMBAI GODADDYLLCV2', NULL, 'POS 514834XXXXXX7103 252091 12APR26 15:42:33 MUMBAI GODADDYLLCV2', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610294967459', 'credit', 732610, 2680053, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610294967459-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000392318246', 'debit', 2250000, 430053, 'upi', 'AFEEFA IMPEX AGENCIES', '50KG', '50200116872951-TPT-50KG-AFEEFA IMPEX AGENCIES', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000610296107123', 'credit', 369500, 799553, 'imps', 'PAYTM', NULL, 'IMPS-610296107123-PAYTMPAYMENTSSERVICESLTDPAYMENTAGGREGATORESCR-UTIB-XXXXXXXXXXX2533-IMPS', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00929647768', 'debit', 700000, 99553, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00929647768-NBXZE3VUUKW8CEG7', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00929647768-NBXZE3VUUKW8CEG7', '2026-04-12T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61034637188', 'credit', 71500, 171053, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61034637188', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610397075703', 'credit', 1056761, 1227814, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610397075703-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000719162', 'debit', 78600, 1149214, 'card', '719162 13APR26 11:17:45 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 719162 13APR26 11:17:45 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00930618649', 'debit', 300000, 849214, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00930618649-NBXTBCJCK4CAVBCU', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00930618649-NBXTBCJCK4CAVBCU', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000542538', 'debit', 18500, 830714, 'card', '542538 13APR26 14:21:38 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 542538 13APR26 14:21:38 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610398514860', 'credit', 560491, 1391205, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610398514860-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00932232096', 'debit', 600000, 791205, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00932232096-300 OFFICE EXP', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00932232096-300 OFFICE EXP', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00932348803', 'debit', 775000, 16205, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00932348803-MILK POWD', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00932348803-MILK POWDER', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Jay And Jay Milk Powder Vendor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000806335', 'debit', 16000, 205, 'card', '806335 13APR26 23:05:57 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 806335 13APR26 23:05:57 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61044874977', 'credit', 147424, 147629, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61044874977', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610400892627', 'credit', 936096, 1083725, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610400892627-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000246441', 'debit', 27500, 1056225, 'card', '246441 14APR26 12:03:02 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 246441 14APR26 12:03:02 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00933024771', 'debit', 1000000, 56225, 'neft', 'MUDASSIR PASHA-NETBANK, MUM-HDFCH00933024771-CHARCOAL', 'KKBK0008061', 'NEFT DR-KKBK0008061-MUDASSIR  PASHA-NETBANK, MUM-HDFCH00933024771-CHARCOAL', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mudassir Pasha Charcoal Supplier [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000752891', 'debit', 18000, 38225, 'card', '752891 14APR26 12:39:33 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 752891 14APR26 12:39:33 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('eazydiner', 'hdfc_ca_4680', 'YESF361046381444', 'credit', 100, 38325, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF361046381444', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610402115969', 'credit', 461159, 499484, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610402115969-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00933783229', 'debit', 400000, 99484, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00933783229-NBACGQYERSCTVAUB', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00933783229-NBACGQYERSCTVAUB', '2026-04-14T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61054399960', 'credit', 458174, 557658, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61054399960', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610504290246', 'credit', 946903, 1504561, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610504290246-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000509724', 'debit', 494956, 1009605, 'card', '509724 15APR26 12:08:29 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 509724 15APR26 12:08:29 SAN FRANCISCO ANTHROPIC', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000444448', 'debit', 200000, 809605, 'card', '444448 15APR26 13:33:57 MUMBAI GOOGLESERVIS', NULL, 'POS 514834XXXXXX7103 444448 15APR26 13:33:57 MUMBAI GOOGLESERVIS', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000403477', 'debit', 15900, 793705, 'card', '403477 15APR26 14:28:34 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 403477 15APR26 14:28:34 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000569865949323', 'credit', 400000, 1193705, 'upi', 'NAVEENKUMAR.CA0@YBL', 'NAVEENKUMAR.CA0@YBL', 'UPI-B NAVEEN KUMAR-NAVEENKUMAR.CA0@YBL-FDRL0001104-569865949323-PAYMENT FROM PHONE', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26653030360', 'credit', 184781, 1378486, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26653030360', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26653030360', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610505677595', 'credit', 480147, 1858633, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610505677595-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000498430667', 'debit', 1800000, 58633, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'NBEXFG2Q3CYGXQ5R', '50200055075789-TPT-NBEXFG2Q3CYGXQ5R-SHARIFF DEPARTMENTAL STORES', '2026-04-15T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61064655755', 'credit', 333000, 391633, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61064655755', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610607912928', 'credit', 936247, 1327880, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610607912928-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000562075', 'debit', 10400, 1317480, 'card', '562075 16APR26 09:13:21 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 562075 16APR26 09:13:21 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000892221', 'debit', 9900, 1307580, 'card', '892221 16APR26 13:14:20 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 892221 16APR26 13:14:20 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000120621', 'debit', 496152, 811428, 'card', '120621 16APR26 14:23:47 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 120621 16APR26 14:23:47 SAN FRANCISCO ANTHROPIC', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000197307', 'debit', 127448, 683980, 'card', '197307 16APR26 14:24:15 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 197307 16APR26 14:24:15 SAN FRANCISCO ANTHROPIC', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000356458', 'debit', 300, 683680, 'card', '356458 16APR26 14:37:50 GURGAON FACEBOOK', NULL, 'POS 514834XXXXXX7103 356458 16APR26 14:37:50 GURGAON FACEBOOK', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000456079', 'debit', 12185, 671495, 'card', '456079 16APR26 14:38:35 GURGAON FACEBOOK', NULL, 'POS 514834XXXXXX7103 456079 16APR26 14:38:35 GURGAON FACEBOOK', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000556650', 'debit', 150000, 521495, 'card', '556650 16APR26 14:39:57 GURGAON WWW FACEBOOK COM ADSMA', NULL, 'POS 514834XXXXXX7103 556650 16APR26 14:39:57 GURGAON WWW FACEBOOK COM ADSMA', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610609188781', 'credit', 100, 521595, 'imps', 'BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', NULL, 'IMPS-610609188781-BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610609270092', 'credit', 467286, 988881, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610609270092-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0362', 'credit', 200, 989081, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0363', 'credit', 200, 989281, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0364', 'credit', 200, 989481, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610649571691', 'debit', 900000, 89481, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', NULL, 'IMPS-610649571691-TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', '2026-04-16T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61074652252', 'credit', 532941, 622422, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61074652252', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610711533950', 'credit', 915374, 1537796, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610711533950-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000051672', 'debit', 10128, 1527668, 'card', '051672 17APR26 15:05:14 SINGAPORE ORACLE SINGAPORE', NULL, 'POS 514834XXXXXX7103 051672 17APR26 15:05:14 SINGAPORE ORACLE  SINGAPORE', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000051672', 'credit', 10128, 1537796, 'card', '051672 17APR26 15:09:02 SINGAPORE ORACLE SINGAPORE', NULL, 'POS 514834XXXXXX7103 051672 17APR26 15:09:02 SINGAPORE ORACLE  SINGAPORE', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000373303', 'debit', 44762, 1493034, 'card', '373303 17APR26 16:21:56 SAN FRANCISCO FLY.IO', NULL, 'POS 514834XXXXXX7103 373303 17APR26 16:21:56 SAN FRANCISCO FLY.IO', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000373303', 'credit', 44762, 1537796, 'card', '373303 17APR26 16:23:50 SAN FRANCISCO FLY.IO', NULL, 'POS 514834XXXXXX7103 373303 17APR26 16:23:50 SAN FRANCISCO FLY.IO', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610712921760', 'credit', 510682, 2048478, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610712921760-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00940379688', 'debit', 2000000, 48478, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00940379688-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00940379688-PETTY CASH', '2026-04-17T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61084660915', 'credit', 474163, 522641, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61084660915', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610815014467', 'credit', 1193535, 1716176, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610815014467-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00941389192', 'debit', 1500000, 216176, 'neft', 'B NAVEEN KUMAR-NETBANK, MUM-HDFCH00941389192-RECOVERY AMOUNT', 'FDRL0001104', 'NEFT DR-FDRL0001104-B NAVEEN KUMAR-NETBANK, MUM-HDFCH00941389192-RECOVERY AMOUNT', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610816261851', 'credit', 642774, 858950, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610816261851-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_0378', 'credit', 300, 859250, 'card_refund', 'FACEBOOK', NULL, 'CRV POS 514834******7103 FACEBOOK', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', '0000119972111086', 'credit', 444000, 1303250, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-119972111086-AWSPG2026041800010', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610816654443', 'credit', 375334, 1678584, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610816654443-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610850329279', 'debit', 1600000, 78584, 'imps', 'AJIM MOHAMMAD-UTIB-XXXXXXXXXXX1634-SALARY', NULL, 'IMPS-610850329279-AJIM MOHAMMAD-UTIB-XXXXXXXXXXX1634-SALARY', '2026-04-18T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Ajim Mohammad Head Cook Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'AXNPM10948864441', 'credit', 270800, 349384, 'neft', 'PAYTM', 'UTIB0000022', 'NEFT CR-UTIB0000022-PAYTM PAYMENTS SERVICES LTD-PAYMENT AGGREGATOR ES-HN HOTELS PRIVATE LIMITED-AXNPM10948864441', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610918352370', 'credit', 1109175, 1458559, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610918352370-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000202934', 'debit', 16000, 1442559, 'card', '202934 19APR26 13:10:13 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 202934 19APR26 13:10:13 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610950550798', 'debit', 1200000, 242559, 'imps', 'MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', NULL, 'IMPS-610950550798-MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000610919375874', 'credit', 600864, 843423, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610919375874-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610950622378', 'debit', 800000, 43423, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-TABARAK SALARY', NULL, 'IMPS-610950622378-TANVEER AHMED-SBIN-XXXXXXX8124-TABARAK SALARY', '2026-04-19T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000504413', 'debit', 27500, 15923, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 504413 20APR26 00:28:37 NOIDA PTM*SWIGGY', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61104781065', 'credit', 833165, 849088, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61104781065', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611021308672', 'credit', 1149328, 1998416, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611021308672-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000666032', 'debit', 22100, 1976316, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 666032 20APR26 12:52:46 GURGAON PAY*SWIGGY INSTAMART', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611094582701', 'credit', 100, 1976416, 'imps', 'API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', NULL, 'IMPS-611094582701-API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611022597195', 'credit', 552094, 2528510, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611022597195-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611051007617', 'debit', 1200000, 1328510, 'imps', 'MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', NULL, 'IMPS-611051007617-MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611051027507', 'debit', 1200000, 128510, 'imps', 'MOHAMMED ISMAIL-JAKA-XXXXXXXXXXXX4806-2 WEEKS SALARY', NULL, 'IMPS-611051027507-MOHAMMED ISMAIL-JAKA-XXXXXXXXXXXX4806-2 WEEKS SALARY', '2026-04-20T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Mohammed Ismail Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61114514085', 'credit', 941930, 1070440, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61114514085', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611124631529', 'credit', 819071, 1889511, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611124631529-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611151324178', 'debit', 920000, 969511, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-HAMZA SALARY', NULL, 'IMPS-611151324178-TANVEER AHMED-SBIN-XXXXXXX8124-HAMZA SALARY', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611125840888', 'credit', 428594, 1398105, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611125840888-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('eazydiner', 'hdfc_ca_4680', 'YESF361116154870', 'credit', 68994, 1467099, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF361116154870', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00947958650', 'debit', 1400000, 67099, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00947958650-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00947958650-PETTY CASH', '2026-04-21T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000990762', 'debit', 9900, 57199, 'card', '990762 22APR26 01:56:08 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 990762 22APR26 01:56:08 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('paytm', 'hdfc_ca_4680', 'YESAP61124339323', 'credit', 590200, 647399, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61124339323', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611227870539', 'credit', 780647, 1428046, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611227870539-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26655781913', 'credit', 682996, 2111042, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655781913', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655781913', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26655779686', 'credit', 79745, 2190787, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655779686', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655779686', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status, notes)
VALUES ('razorpay', 'hdfc_ca_4680', '0000611229093078', 'credit', 433749, 2624536, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611229093078-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-22T00:00:00+05:30', '2026-04-23T19:39:53.838325+05:30', 'parsed', '');

UPDATE money_source_health SET last_event_at='2026-04-23T19:39:53.838325+05:30', last_checked_at=CURRENT_TIMESTAMP, status='healthy' WHERE source='hdfc' AND instrument='hdfc_ca_4680';

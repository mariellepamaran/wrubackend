var arr = [];
logs.forEach(val => {
	const str = val.textPayload;

  var eventId = str.substring(
      str.indexOf("Event Id: ") + 10, 
      str.lastIndexOf(" Event Type:")
  );
  var eventType = str.substring(
      str.indexOf("Event Type: ") + 12, 
      str.lastIndexOf(" Time: ")
  );
  var eventTime = str.substring(
      str.indexOf("Time: ") + 6, 
      str.lastIndexOf("")
  );

	arr.push({
    "Date and Time": eventTime,
    "Event Id": eventId,
    "Event Type": eventType,
  });
});
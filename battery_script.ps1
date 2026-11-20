Clear-Host
$userEmail = Read-Host "Enter RBMS username (email)"
$securePwd = Read-Host "Enter password" -MaskInput

$AuthBody = @{
    email = $userEmail
    password = $securePwd
} | ConvertTo-Json

$param = @{
    Uri         = "https://api.ruggedbooksms.com/sessions"
    Method      = "Post"
    Body        = $AuthBody
    ContentType = "application/json"
}

$responseSession = Invoke-RestMethod @param -ErrorAction Continue -ErrorVariable oErr

if($oErr) {
	Write-Error -Message "Either the email or password you entered is incorrect" -ErrorAction Stop
	$oErr = $Null
}

Clear-Host

$headers = @{
    Authorization   = "Bearer "+$responseSession.token
}

while($val -ne 'quit')
{
  $val = Read-Host "Enter battery serial number"

  if (($val.Length -gt 4) -and ($val.substring(0, 4) -eq 'P/N:')) {
    $newVal = $val.substring($val.IndexOf("S/N:") + 4)
  } else {
    $newVal = $val
  }
  
  powercfg /batteryreport /output "$env:TEMP\$newVal.html"

  $filePath = "$env:TEMP\$newVal.html"

  $form = @{
      file          = Get-Item -Path $filePath
      serial_number  = $newVal
  }

  $uploadParam = @{
      Uri           = "https://api.ruggedbooksms.com/inventory_items/batteryReportUpload"
      Method        = "Put"
      Headers       = $headers
      Form          = $form
      ContentType   = "multipart/form-data"
  }

  $responseSession = Invoke-RestMethod @uploadParam
  
  if($responseSession.error) {
    Write-Host "This Serial Number was not found on RBMS" -ForegroundColor White -BackgroundColor Red
  } else {
    Write-Host "Battery report saved on RBMS" -ForegroundColor White -BackgroundColor Green
  }
}

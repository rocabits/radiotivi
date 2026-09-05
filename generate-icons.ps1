Add-Type -AssemblyName System.Drawing

function New-Icon($size, $outputPath) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'

  $green = [System.Drawing.Color]::FromArgb(46, 204, 113)
  $white = [System.Drawing.Color]::FromArgb(255, 255, 255)

  $g.Clear($green)

  $s = [double]($size) / 100.0
  $wb = New-Object System.Drawing.SolidBrush($white)
  $gb = New-Object System.Drawing.SolidBrush($green)

  # White circle (r=38, centered)
  $g.FillEllipse($wb, [float]((50-38)*$s), [float]((50-38)*$s), [float](76*$s), [float](76*$s))

  # Play triangle centered (matches the "50" footprint, ~25px wide x 32px tall at 100)
  $pts = @(
    (New-Object System.Drawing.PointF([float](42*$s), [float](34*$s))),
    (New-Object System.Drawing.PointF([float](42*$s), [float](66*$s))),
    (New-Object System.Drawing.PointF([float](65*$s), [float](50*$s)))
  )
  $g.FillPolygon($gb, $pts)

  $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $wb.Dispose()
  $gb.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

$root = "C:\Users\PEPELUIS\Desktop\apps\radiotivi"
New-Icon 192 "$root\icon-192.png"
New-Icon 512 "$root\icon-512.png"
Write-Host "Iconos generados correctamente"

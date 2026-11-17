// Can a hero put at (x0,y0) of a zone be ordered to each of the given points?  go run ./probe gz2mg 34 86 46 93 48 111 ...
package main

import (
	"fmt"
	"os"
	"runtime"
	"strconv"

	"newei/engine"
	"newei/gl"
	"newei/win"
)

func main() {
	runtime.LockOSThread()
	w, _ := win.Open("probe", 64, 64, false)
	defer w.Close()
	gl.Init()
	a, _ := engine.OpenAssets(`C:\GOG Games\EI_edit\Evil Islands`)
	c, _ := engine.NewGame(a)
	z, _, err := c.Enter(os.Args[1], 1, 12)
	if err != nil {
		fmt.Println(err)
		return
	}
	f := func(i int) float32 { v, _ := strconv.ParseFloat(os.Args[i], 32); return float32(v) }
	now := 0.0
	for i := 0; i < 20; i++ {
		now += engine.TickSeconds
		z.Update(now)
	}
	h := z.Party()[0]
	named := false
	if n := os.Args[len(os.Args)-1]; n[0] == '@' {
		for _, u := range z.Units {
			if u.In.Obj.Name == n[1:] {
				z.Party()[0].Pos[0], z.Party()[0].Pos[1] = u.Pos[0]+8, u.Pos[1]+8
				h, named = u, true
			}
		}
		os.Args = os.Args[:len(os.Args)-1]
	}
	for i := 4; i+1 < len(os.Args); i += 2 {
		if !named {
			h.Pos[0], h.Pos[1] = f(2), f(3)
		}
		fmt.Printf("%s at %.1f,%.1f: ", h.In.Obj.Name, h.Pos[0], h.Pos[1])
		ok := z.MoveTo(h, f(i), f(i+1))
		for k := 0; k < 1500; k++ {
			now += engine.TickSeconds
			z.Update(now)
		}
		fmt.Printf("%.0f,%.0f -> %.0f,%.0f: order %v, arrived at %.0f,%.0f\n", f(2), f(3), f(i), f(i+1), ok, h.Pos[0], h.Pos[1])
	}
}

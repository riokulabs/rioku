package fixtures

import "fmt"

func init() {
	Register(Fixture{
		Name:  "services",
		Order: 200,
		Run:   seedServices,
	})
}

func seedServices(r *Runner) error {
	count := 5
	if r.Mode() == "rich" {
		count = 40
	}
	for i := 0; i < count; i++ {
		body := map[string]any{
			"name":     fmt.Sprintf("svc-%03d", i),
			"upstream": fmt.Sprintf("http://upstream-%03d.example.com", i),
		}
		path := fmt.Sprintf("/t/%s/services", r.Tenant())
		resp, err := r.Post(path, body)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode >= 300 && resp.StatusCode != 409 {
			return fmt.Errorf("services seed: %s -> %d", body["name"], resp.StatusCode)
		}
	}
	return nil
}

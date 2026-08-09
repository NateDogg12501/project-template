# The bucket ../backend.tf points at. `terraform output` here is the only place
# that name is derived rather than written down.
output "state_bucket" {
  value = module.tf_state.bucket_id
}
